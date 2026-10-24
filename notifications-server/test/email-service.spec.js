jest.mock("../dist/emails/EmailQueue", () => ({
  ...jest.requireActual("../dist/emails/EmailQueue"),
  EmailQueueEnqueue: jest.fn(),
  EmailQueueSetTransport: jest.fn(),
  CreateTransportFromConfig: jest.fn(),
  BuildEmailMessage: jest.fn(),
}));
jest.mock("../dist/emails/EmailDeliveriesData", () => ({
  EmailDeliveriesRecord: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../dist/emails/EmailRulesData", () => ({
  EmailRulesMatching: jest.fn().mockResolvedValue([]),
}));
jest.mock("../dist/OTelContext", () => ({
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }),
}));

const {
  EmailQueueEnqueue,
  EmailQueueSettings,
  CreateTransportFromConfig,
  BuildEmailMessage,
} = require("../dist/emails/EmailQueue");
const { EmailDeliveriesRecord } = require("../dist/emails/EmailDeliveriesData");
const { EmailRulesMatching } = require("../dist/emails/EmailRulesData");
const {
  EmailEvaluateNotification,
  EmailInit,
  EmailIsConfigured,
  EmailSendTest,
} = require("../dist/emails/EmailService");

const MOCK_MESSAGE = { to: "mock-recipient@example.com" };

function notification(overrides = {}) {
  return {
    id: "notification-id",
    title: "Build",
    body: "Done",
    severity: "error",
    source: "ci",
    data: "{}",
    createdAt: "2026-10-14T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  BuildEmailMessage.mockReturnValue(MOCK_MESSAGE);
  EmailInit({
    SMTP_HOST: "",
    SMTP_FROM: "",
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    APP_PUBLIC_URL: "",
  });
});

describe("email service", () => {
  test("reports the SMTP configuration state", () => {
    expect(EmailIsConfigured()).toBe(false);
    EmailInit({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "noreply@example.com",
    });
    expect(EmailIsConfigured()).toBe(true);
  });

  test("enqueues one email per distinct matching recipient", async () => {
    EmailInit({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "noreply@example.com",
    });
    EmailRulesMatching.mockResolvedValueOnce([
      { id: "rule-1", recipient: "user@example.com" },
      { id: "rule-2", recipient: "other@example.com" },
      { id: "rule-3", recipient: "user@example.com" },
    ]);
    await EmailEvaluateNotification(undefined, notification());

    expect(EmailQueueEnqueue).toHaveBeenCalledTimes(2);
    const recipients = EmailQueueEnqueue.mock.calls.map(
      (call) => call[0].recipient,
    );
    expect(recipients).toEqual(
      expect.arrayContaining(["user@example.com", "other@example.com"]),
    );
    expect(EmailQueueEnqueue.mock.calls[0][0].notification.id).toBe(
      "notification-id",
    );
  });

  test("skips evaluation when email is not configured", async () => {
    await EmailEvaluateNotification(undefined, notification());
    expect(EmailRulesMatching).not.toHaveBeenCalled();
    expect(EmailQueueEnqueue).not.toHaveBeenCalled();
  });

  test("sends the test email through a configured transport and records the outcome", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    CreateTransportFromConfig.mockReturnValueOnce({ sendMail });
    await expect(EmailSendTest(undefined, "user@example.com")).resolves.toBeUndefined();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(MOCK_MESSAGE);
    expect(EmailDeliveriesRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipient: "user@example.com",
        notificationTitle: "Test email",
        status: "sent",
        attempts: 1,
        error: "",
      }),
    );
  });

  test("records and rethrows a failed test email", async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error("smtp down"));
    CreateTransportFromConfig.mockReturnValueOnce({ sendMail });
    await expect(EmailSendTest(undefined, "user@example.com")).rejects.toThrow("smtp down");
    expect(EmailDeliveriesRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipient: "user@example.com",
        status: "failed",
        error: "Error: smtp down",
      }),
    );
  });

  test("bounds the test email with the send timeout", async () => {
    const originalTimeout = EmailQueueSettings.sendTimeoutMs;
    jest.useFakeTimers();
    try {
      EmailQueueSettings.sendTimeoutMs = 50;
      const sendMail = jest.fn(() => new Promise(() => {})); // never settles
      CreateTransportFromConfig.mockReturnValueOnce({ sendMail });
      const promise = EmailSendTest(undefined, "user@example.com");
      const rejection = expect(promise).rejects.toThrow("timed out after 50ms");
      await jest.advanceTimersByTimeAsync(50);
      await rejection;

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(EmailDeliveriesRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: "failed",
          attempts: 1,
          error: expect.stringContaining("timed out after 50ms"),
        }),
      );
    } finally {
      EmailQueueSettings.sendTimeoutMs = originalTimeout;
      jest.useRealTimers();
    }
  });

  test("throws when sending a test email without a transport", async () => {
    await expect(EmailSendTest(undefined, "user@example.com")).rejects.toThrow(
      "Email not configured",
    );
    expect(EmailDeliveriesRecord).not.toHaveBeenCalled();
  });
});
