jest.mock("@devopsplaybook.io/common-utils", () => ({
  DbUtilsExecSQL: jest.fn().mockResolvedValue(1),
  DbUtilsQuerySQL: jest.fn(),
}));
const mockPushWarn = jest.fn();
const mockPushCounterAdd = jest.fn();
jest.mock("../dist/OTelContext", () => ({
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  mockPushWarn,
  mockPushCounterAdd,
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: mockPushWarn,
      error: jest.fn(),
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
const mockOtel = require("../dist/OTelContext");
const { PushSendToAll, PushInit } = require("../dist/notifications/PushService");

describe("push delivery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PushInit({
      VAPID_PUBLIC_KEY: "public",
      VAPID_PRIVATE_KEY: "private",
      VAPID_SUBJECT: "mailto:test@example.com",
    });
    DbUtilsQuerySQL.mockResolvedValue([
      {
        endpoint: "https://push.example/subscription",
        subscription: JSON.stringify({ endpoint: "https://push.example" }),
      },
    ]);
    webpush.sendNotification.mockResolvedValue(undefined);
  });

  test("sends notification context with a bounded timeout", async () => {
    await PushSendToAll({
      id: "notification-id",
      title: "Build",
      body: "Done",
      severity: "success",
      source: "ci",
      data: '{"run":4}',
    });
    const [subscription, rawPayload, options] =
      webpush.sendNotification.mock.calls[0];
    expect(subscription.endpoint).toBe("https://push.example");
    expect(JSON.parse(rawPayload)).toMatchObject({
      id: "notification-id",
      data: '{"run":4}',
      url: "/",
    });
    expect(options.timeout).toBe(5000);
  });

  test("logs and counts non-pruned send failures", async () => {
    webpush.sendNotification.mockRejectedValue({ statusCode: 503 });
    await PushSendToAll({
      id: "notification-id",
      title: "Build",
      body: "Failed",
      severity: "error",
      source: "ci",
      data: "{}",
    });
    expect(DbUtilsExecSQL).not.toHaveBeenCalled();
    expect(mockOtel.mockPushWarn).toHaveBeenCalledWith(
      expect.stringContaining("status 503"),
      expect.anything(),
    );
    expect(mockOtel.mockPushCounterAdd).toHaveBeenCalledWith(1);
  });

  test("prunes gone subscriptions", async () => {
    webpush.sendNotification.mockRejectedValue({ statusCode: 410 });
    await PushSendToAll({
      id: "notification-id",
      title: "Build",
      body: "Failed",
      severity: "error",
      source: "ci",
      data: "{}",
    });
    expect(DbUtilsExecSQL).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("DELETE FROM push_subscriptions"),
      ["https://push.example/subscription"],
    );
  });
});
