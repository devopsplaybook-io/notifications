jest.mock("../dist/emails/EmailQueue", () => ({
  EmailQueueEnqueue: jest.fn(),
  EmailQueueSetTransport: jest.fn(),
  CreateTransportFromConfig: jest.fn(),
  BuildEmailMessage: jest.fn(),
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

const { EmailQueueEnqueue, CreateTransportFromConfig, BuildEmailMessage } = require("../dist/emails/EmailQueue");
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

  test("sends the test email through a configured transport", async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    CreateTransportFromConfig.mockReturnValueOnce({ sendMail });
    await expect(EmailSendTest(undefined, "user@example.com")).resolves.toBeUndefined();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(MOCK_MESSAGE);
  });

  test("throws when sending a test email without a transport", async () => {
    await expect(EmailSendTest(undefined, "user@example.com")).rejects.toThrow(
      "Email not configured",
    );
  });
});
