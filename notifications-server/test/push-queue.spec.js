const mockPushWarn = jest.fn();
const mockPushError = jest.fn();
const mockPushCounterAdd = jest.fn();
jest.mock("@devopsplaybook.io/common-utils", () => ({
  DbUtilsExecSQL: jest.fn().mockResolvedValue(1),
  DbUtilsQuerySQL: jest.fn(),
}));
jest.mock("../dist/OTelContext", () => ({
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  mockPushWarn,
  mockPushError,
  mockPushCounterAdd,
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: mockPushWarn,
      error: mockPushError,
    }),
  }),
  OTelMeter: () => ({
    createCounter: () => ({ add: mockPushCounterAdd }),
  }),
}));
jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

const {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} = require("@devopsplaybook.io/common-utils");
const webpush = require("web-push");
const {
  BuildPushPayload,
  PushQueueEnqueue,
  PushQueueSettings,
  PushQueueWaitForIdle,
  PUSH_PAYLOAD_TITLE_MAX,
  PUSH_PAYLOAD_BODY_MAX,
} = require("../dist/push/PushQueue");

const DEFAULT_SETTINGS = { ...PushQueueSettings };

function subscriptionRow(endpoint) {
  return {
    endpoint,
    subscription: JSON.stringify({ endpoint }),
  };
}

function notification(overrides = {}) {
  return {
    id: "notification-id",
    title: "Build",
    body: "Done",
    severity: "success",
    source: "ci",
    data: '{"run":4}',
    ...overrides,
  };
}

describe("push queue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(PushQueueSettings, DEFAULT_SETTINGS);
    DbUtilsQuerySQL.mockResolvedValue([subscriptionRow("https://push.example/subscription")]);
    webpush.sendNotification.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await PushQueueWaitForIdle();
    Object.assign(PushQueueSettings, DEFAULT_SETTINGS);
  });

  test("bounds the push payload (truncates title/body, drops data)", () => {
    const payload = JSON.parse(
      BuildPushPayload(
        notification({
          title: "t".repeat(PUSH_PAYLOAD_TITLE_MAX + 50),
          body: "b".repeat(PUSH_PAYLOAD_BODY_MAX + 50),
        }),
      ),
    );
    expect(payload.title).toHaveLength(PUSH_PAYLOAD_TITLE_MAX);
    expect(payload.title.endsWith("…")).toBe(true);
    expect(payload.body).toHaveLength(PUSH_PAYLOAD_BODY_MAX);
    expect(payload.body.endsWith("…")).toBe(true);
    expect(payload).not.toHaveProperty("data");
    expect(payload.url).toBe("/");
    expect(payload.id).toBe("notification-id");
  });

  test("enqueues without waiting for delivery", async () => {
    let resolveQuery;
    DbUtilsQuerySQL.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );
    PushQueueEnqueue(notification());
    expect(webpush.sendNotification).not.toHaveBeenCalled();

    resolveQuery([subscriptionRow("https://push.example/subscription")]);
    await PushQueueWaitForIdle();
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  });

  test("retries failed deliveries with backoff and eventually succeeds", async () => {
    PushQueueSettings.retryBaseDelayMs = 25;
    webpush.sendNotification
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce(undefined);
    const startedAt = Date.now();
    PushQueueEnqueue(notification());
    await PushQueueWaitForIdle();
    const elapsed = Date.now() - startedAt;

    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(mockPushCounterAdd).not.toHaveBeenCalled();
  });

  test("counts one failure after exhausting the retries", async () => {
    PushQueueSettings.retryBaseDelayMs = 1;
    webpush.sendNotification.mockRejectedValue({ statusCode: 503 });
    PushQueueEnqueue(notification());
    await PushQueueWaitForIdle();

    expect(webpush.sendNotification).toHaveBeenCalledTimes(
      PushQueueSettings.maxAttempts,
    );
    expect(mockPushCounterAdd).toHaveBeenCalledWith(1);
    expect(mockPushWarn).toHaveBeenCalledWith(
      expect.stringContaining("attempt 3/3"),
      expect.anything(),
    );
  });

  test("prunes gone subscriptions without retrying", async () => {
    webpush.sendNotification.mockRejectedValue({ statusCode: 410 });
    PushQueueEnqueue(notification());
    await PushQueueWaitForIdle();

    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(DbUtilsExecSQL).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("DELETE FROM push_subscriptions"),
      ["https://push.example/subscription"],
    );
    expect(mockPushCounterAdd).not.toHaveBeenCalled();
  });

  test("drops notifications once the queue is full", async () => {
    PushQueueSettings.maxQueueSize = 2;
    PushQueueSettings.retryBaseDelayMs = 1;
    let resolveQuery;
    DbUtilsQuerySQL.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    ).mockResolvedValue([subscriptionRow("https://push.example/subscription")]);

    PushQueueEnqueue(notification({ id: "busy" }));
    PushQueueEnqueue(notification({ id: "queued-1" }));
    PushQueueEnqueue(notification({ id: "queued-2" }));
    PushQueueEnqueue(notification({ id: "dropped" }));

    expect(mockPushCounterAdd).toHaveBeenCalledWith(1);
    expect(mockPushWarn).toHaveBeenCalledWith(
      expect.stringContaining("Push queue full"),
    );

    resolveQuery([subscriptionRow("https://push.example/subscription")]);
    await PushQueueWaitForIdle();
    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
  });
});
