jest.mock("../dist/users/Auth", () => ({
  AuthGetUserSession: jest.fn().mockResolvedValue({
    isAuthenticated: false,
    userId: null,
  }),
}));
jest.mock("../dist/emails/EmailRulesData", () => ({
  SEVERITY_MODE_EXACT: "exact",
  SEVERITY_MODE_THRESHOLD: "threshold",
  EmailRulesList: jest.fn().mockResolvedValue([]),
  EmailRulesGet: jest.fn().mockResolvedValue({
    id: "rule-id",
    source: "",
    severity: "error",
    severityMode: "exact",
    recipient: "user@example.com",
    createdAt: "2026-10-14T00:00:00.000Z",
  }),
  EmailRulesCreate: jest.fn(async (_span, source, severity, recipient, severityMode) => ({
    id: "new-rule-id",
    source,
    severity,
    severityMode,
    recipient,
    createdAt: "2026-10-14T00:00:00.000Z",
  })),
  EmailRulesUpdate: jest.fn().mockResolvedValue(true),
  EmailRulesDelete: jest.fn().mockResolvedValue(1),
}));
jest.mock("../dist/emails/EmailDeliveriesData", () => ({
  EmailDeliveriesList: jest.fn().mockResolvedValue([]),
}));
jest.mock("../dist/emails/EmailService", () => ({
  EmailIsConfigured: jest.fn().mockReturnValue(false),
  EmailSendTest: jest.fn().mockResolvedValue(undefined),
}));
const mockLogError = jest.fn();
jest.mock("../dist/OTelContext", () => ({
  OTelRequestSpan: () => undefined,
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: mockLogError,
    }),
  }),
}));

const Fastify = require("fastify");
const { AuthGetUserSession } = require("../dist/users/Auth");
const emailRulesData = require("../dist/emails/EmailRulesData");
const { EmailDeliveriesList } = require("../dist/emails/EmailDeliveriesData");
const { EmailIsConfigured, EmailSendTest } = require("../dist/emails/EmailService");
const { EmailRulesRoutes } = require("../dist/emails/EmailRulesRoutes");
const { IsValidEmailRecipient } = require("../dist/emails/EmailRulesRoutes");

function anAuthenticatedUser() {
  AuthGetUserSession.mockResolvedValueOnce({
    isAuthenticated: true,
    userId: "admin",
  });
}

describe("email rules routes", () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
    AuthGetUserSession.mockResolvedValue({
      isAuthenticated: false,
      userId: null,
    });
    EmailIsConfigured.mockReturnValue(false);
    EmailSendTest.mockResolvedValue(undefined);
    app = Fastify();
    await app.register(new EmailRulesRoutes().getRoutes, { prefix: "/emails" });
    await app.ready();
  });

  afterEach(async () => app.close());

  test("returns 401 for missing sessions", async () => {
    const list = await app.inject({ method: "GET", url: "/emails/rules" });
    expect(list.statusCode).toBe(401);
    const create = await app.inject({
      method: "POST",
      url: "/emails/rules",
      payload: { recipient: "user@example.com" },
    });
    expect(create.statusCode).toBe(401);
    const update = await app.inject({
      method: "PUT",
      url: "/emails/rules/rule-id",
      payload: { recipient: "user@example.com" },
    });
    expect(update.statusCode).toBe(401);
    const remove = await app.inject({ method: "DELETE", url: "/emails/rules/rule-id" });
    expect(remove.statusCode).toBe(401);
    const status = await app.inject({ method: "GET", url: "/emails/status" });
    expect(status.statusCode).toBe(401);
    const deliveries = await app.inject({ method: "GET", url: "/emails/deliveries" });
    expect(deliveries.statusCode).toBe(401);
    const test = await app.inject({
      method: "POST",
      url: "/emails/test",
      payload: { recipient: "user@example.com" },
    });
    expect(test.statusCode).toBe(401);
  });

  test("creates a rule with wildcards and reports 201", async () => {
    anAuthenticatedUser();
    const response = await app.inject({
      method: "POST",
      url: "/emails/rules",
      payload: { recipient: "user@example.com" },
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({
      source: "",
      severity: "",
      severityMode: "exact",
      recipient: "user@example.com",
    });
  });

  test("accepts severityMode on create and update and rejects unknown values", async () => {
    anAuthenticatedUser();
    const threshold = await app.inject({
      method: "POST",
      url: "/emails/rules",
      payload: {
        severity: "warning",
        severityMode: "threshold",
        recipient: "user@example.com",
      },
    });
    expect(threshold.statusCode).toBe(201);
    expect(emailRulesData.EmailRulesCreate).toHaveBeenCalledWith(
      undefined,
      "",
      "warning",
      "user@example.com",
      "threshold",
    );

    anAuthenticatedUser();
    const invalid = await app.inject({
      method: "POST",
      url: "/emails/rules",
      payload: {
        severity: "warning",
        severityMode: "at-least",
        recipient: "user@example.com",
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(JSON.parse(invalid.body).error).toBe("Invalid: severityMode");

    anAuthenticatedUser();
    const updated = await app.inject({
      method: "PUT",
      url: "/emails/rules/rule-id",
      payload: {
        severity: "error",
        severityMode: "threshold",
        recipient: "other@example.com",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(emailRulesData.EmailRulesUpdate).toHaveBeenCalledWith(
      undefined,
      "rule-id",
      "",
      "error",
      "other@example.com",
      "threshold",
    );

    anAuthenticatedUser();
    const invalidUpdate = await app.inject({
      method: "PUT",
      url: "/emails/rules/rule-id",
      payload: {
        severity: "error",
        severityMode: 42,
        recipient: "other@example.com",
      },
    });
    expect(invalidUpdate.statusCode).toBe(400);
  });

  test("lists recent deliveries for authenticated sessions", async () => {
    anAuthenticatedUser();
    EmailDeliveriesList.mockResolvedValueOnce([
      {
        id: "delivery-1",
        recipient: "user@example.com",
        notificationId: "notification-1",
        notificationTitle: "Build failed",
        source: "ci",
        severity: "error",
        status: "failed",
        attempts: 3,
        error: "smtp down",
        createdAt: "2026-10-17T10:00:00.000Z",
      },
    ]);
    const deliveries = await app.inject({ method: "GET", url: "/emails/deliveries" });
    expect(deliveries.statusCode).toBe(200);
    expect(JSON.parse(deliveries.body).deliveries).toHaveLength(1);
    expect(JSON.parse(deliveries.body).deliveries[0]).toMatchObject({
      recipient: "user@example.com",
      status: "failed",
    });
  });

  test("trims and rejects invalid rule fields", async () => {
    AuthGetUserSession.mockResolvedValue({
      isAuthenticated: true,
      userId: "admin",
    });
    const trimmed = await app.inject({
      method: "POST",
      url: "/emails/rules",
      payload: {
        source: "  fluxcd  ",
        severity: " ERROR ",
        recipient: "user@example.com",
      },
    });
    expect(trimmed.statusCode).toBe(201);
    expect(JSON.parse(trimmed.body)).toMatchObject({
      source: "fluxcd",
      severity: "ERROR",
    });

    for (const payload of [
      { source: "x".repeat(201), recipient: "user@example.com" },
      { severity: "x".repeat(21), recipient: "user@example.com" },
      { recipient: "" },
      { recipient: "not-an-email" },
      { recipient: "user@example.com\nBcc: victim@example.com" },
      { recipient: "user@example.com\r" },
      { recipient: "a b@example.com" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/emails/rules",
        payload,
      });
      expect({ payload, status: response.statusCode }).toEqual({
        payload,
        status: 400,
      });
    }
  });

  test("returns 404 when updating or deleting a rule that does not exist", async () => {
    anAuthenticatedUser();
    emailRulesData.EmailRulesGet.mockResolvedValueOnce(undefined);
    const missingUpdate = await app.inject({
      method: "PUT",
      url: "/emails/rules/missing",
      payload: { recipient: "user@example.com" },
    });
    expect(missingUpdate.statusCode).toBe(404);

    anAuthenticatedUser();
    const update = await app.inject({
      method: "PUT",
      url: "/emails/rules/rule-id",
      payload: { source: "gh", severity: "error", recipient: "other@example.com" },
    });
    expect(update.statusCode).toBe(200);
    expect(emailRulesData.EmailRulesUpdate).toHaveBeenCalledWith(
      undefined,
      "rule-id",
      "gh",
      "error",
      "other@example.com",
      "exact",
    );

    anAuthenticatedUser();
    emailRulesData.EmailRulesDelete.mockResolvedValueOnce(0);
    const missingDelete = await app.inject({
      method: "DELETE",
      url: "/emails/rules/missing",
    });
    expect(missingDelete.statusCode).toBe(404);
  });

  test("reports whether SMTP is configured", async () => {
    anAuthenticatedUser();
    EmailIsConfigured.mockReturnValueOnce(true);
    const configured = await app.inject({ method: "GET", url: "/emails/status" });
    expect(configured.statusCode).toBe(200);
    expect(JSON.parse(configured.body)).toEqual({ smtpConfigured: true });

    anAuthenticatedUser();
    const unconfigured = await app.inject({ method: "GET", url: "/emails/status" });
    expect(JSON.parse(unconfigured.body)).toEqual({ smtpConfigured: false });
  });

  test("validates the test email endpoint", async () => {
    anAuthenticatedUser();
    const invalid = await app.inject({
      method: "POST",
      url: "/emails/test",
      payload: { recipient: "nope" },
    });
    expect(invalid.statusCode).toBe(400);

    anAuthenticatedUser();
    const unconfigured = await app.inject({
      method: "POST",
      url: "/emails/test",
      payload: { recipient: "user@example.com" },
    });
    expect(unconfigured.statusCode).toBe(400);
    expect(JSON.parse(unconfigured.body).error).toBe("Email not configured");

    anAuthenticatedUser();
    EmailIsConfigured.mockReturnValueOnce(true);
    const sent = await app.inject({
      method: "POST",
      url: "/emails/test",
      payload: { recipient: "user@example.com" },
    });
    expect(sent.statusCode).toBe(200);
    expect(EmailSendTest).toHaveBeenCalledWith(undefined, "user@example.com");

    anAuthenticatedUser();
    EmailIsConfigured.mockReturnValueOnce(true);
    EmailSendTest.mockRejectedValueOnce(new Error("smtp down"));
    const failed = await app.inject({
      method: "POST",
      url: "/emails/test",
      payload: { recipient: "user@example.com" },
    });
    expect(failed.statusCode).toBe(502);
    expect(mockLogError).toHaveBeenCalledWith(
      "Test email delivery failed",
      expect.any(Error),
      undefined,
    );
  });

  test("rejects recipients outside the simple address shape", () => {
    expect(IsValidEmailRecipient("user@example.com")).toBe(true);
    expect(IsValidEmailRecipient("USER+tag@sub.example.com")).toBe(true);
    expect(IsValidEmailRecipient("user@localhost")).toBe(false);
    expect(IsValidEmailRecipient("user@")).toBe(false);
    expect(IsValidEmailRecipient("@example.com")).toBe(false);
    expect(IsValidEmailRecipient("user name@example.com")).toBe(false);
    expect(IsValidEmailRecipient("a".repeat(321) + "@example.com")).toBe(false);
    expect(IsValidEmailRecipient(undefined)).toBe(false);
  });
});
