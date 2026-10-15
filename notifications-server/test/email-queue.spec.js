const mockEmailCounterAdd = jest.fn();
const mockSendMail = jest.fn();
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(),
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
  OTelMeter: () => ({
    createCounter: () => ({ add: mockEmailCounterAdd }),
  }),
}));

const nodemailer = require("nodemailer");
const {
  BuildEmailMessage,
  CreateTransportFromConfig,
  EmailQueueEnqueue,
  EmailQueueSetTransport,
  EmailQueueSettings,
  EmailQueueWaitForIdle,
  MaskRecipient,
  escapeHtml,
  EMAIL_SUBJECT_MAX,
} = require("../dist/emails/EmailQueue");

const DEFAULT_SETTINGS = { ...EmailQueueSettings };

function notification(overrides = {}) {
  return {
    id: "notification-id",
    title: "Build",
    body: "Done",
    severity: "success",
    source: "ci",
    data: '{"run":4}',
    createdAt: "2026-10-14T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(EmailQueueSettings, DEFAULT_SETTINGS);
  mockSendMail.mockResolvedValue(undefined);
});

afterEach(async () => {
  await EmailQueueWaitForIdle();
  Object.assign(EmailQueueSettings, DEFAULT_SETTINGS);
});

describe("email message", () => {
  test("builds subject, text and html parts with a rendered body", () => {
    EmailQueueSetTransport({ sendMail: mockSendMail }, "noreply@example.com", "https://app.example");

    const message = BuildEmailMessage(
      notification({ title: "Deployment <failed>", body: "See log & retry\nSecond line" }),
      "user@example.com",
    );
    expect(message.from).toBe("noreply@example.com");
    expect(message.to).toBe("user@example.com");
    expect(message.subject).toBe("[Notifications] success (ci): Deployment <failed>");
    expect(message.text).toContain("success from ci");
    expect(message.text).toContain("Deployment <failed>");
    expect(message.text).toContain("Open: https://app.example");
    // The title is escaped plain text; the body is markdown-rendered inside a
    // div (markdown emits block elements, so a <p> wrapper would be invalid).
    expect(message.html).toContain("&lt;failed&gt;");
    expect(message.html).toContain("<div><p>See log &amp; retry<br />Second line</p>");
    expect(message.html).toContain('href="https://app.example"');
  });

  test("renders markdown links and drops unsafe urls", () => {
    const message = BuildEmailMessage(
      notification({
        body: "[docs](https://docs.example) and [bad](javascript:alert(1)) and [proto](//evil.com)",
      }),
      "user@example.com",
    );
    expect(message.html).toContain('<a href="https://docs.example">docs</a>');
    expect(message.html).not.toContain("javascript:");
    expect(message.html).not.toContain("//evil.com");
    expect(message.html).toContain("<a>bad</a>");
  });

  test("renders headings, lists, code blocks and tables", () => {
    const message = BuildEmailMessage(
      notification({
        body: [
          "## Title",
          "",
          "- one",
          "- two",
          "",
          "```js",
          "console.log(1);",
          "```",
          "",
          "| a | b |",
          "| --- | --- |",
          "| 1 | 2 |",
        ].join("\n"),
      }),
      "user@example.com",
    );
    expect(message.html).toContain("<h2>Title</h2>");
    expect(message.html).toContain("<li>one</li>");
    expect(message.html).toContain("<pre style=");
    expect(message.html).toContain('class="language-js"');
    expect(message.html).toContain("<table>");
  });

  test("renders a body without markdown as a plain paragraph", () => {
    const message = BuildEmailMessage(notification({ body: "Done" }), "user@example.com");
    expect(message.html).toContain("<div><p>Done</p>");
  });

  test("sanitizes the body and escapes the other producer-controlled fields", () => {
    const message = BuildEmailMessage(
      notification({
        title: '<img src=x onerror="alert(1)">',
        body: "</p><script>alert(1)</script>",
        severity: 'err"or',
        source: 'a"b',
      }),
      "user@example.com",
    );
    expect(message.html).not.toContain("<script");
    expect(message.html).not.toContain("&lt;script&gt;"); // stripped, not shown escaped
    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    // The subject is plain text (MIME-encoded by nodemailer), not HTML
    expect(message.subject).toContain('err"or');
    expect(message.html).toContain("err&quot;or");
  });

  test("omits the source segment when empty and truncates the subject", () => {
    const message = BuildEmailMessage(
      notification({ source: "", title: "x".repeat(500) }),
      "user@example.com",
    );
    expect(message.subject.startsWith("[Notifications] success: ")).toBe(true);
    expect(message.subject.length).toBeLessThanOrEqual(
      EMAIL_SUBJECT_MAX + 1, // the ellipsis character is a single UTF-16 unit
    );
  });
});

describe("recipient masking", () => {
  test("keeps the domain and truncates the local part", () => {
    expect(MaskRecipient("didier@example.com")).toBe("di***@example.com");
    expect(MaskRecipient("no-at-sign")).toBe("***");
  });
});

describe("email queue", () => {
  test("delivers an enqueued job once", async () => {
    EmailQueueSetTransport({ sendMail: mockSendMail }, "noreply@example.com", "");
    EmailQueueEnqueue({ notification: notification(), recipient: "user@example.com" });
    await EmailQueueWaitForIdle();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe("user@example.com");
    expect(mockEmailCounterAdd).not.toHaveBeenCalled();
  });

  test("retries failed deliveries with backoff and eventually succeeds", async () => {
    EmailQueueSettings.retryBaseDelayMs = 5;
    EmailQueueSetTransport({ sendMail: mockSendMail }, "noreply@example.com", "");
    mockSendMail
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockResolvedValueOnce(undefined);
    EmailQueueEnqueue({ notification: notification(), recipient: "user@example.com" });
    await EmailQueueWaitForIdle();

    expect(mockSendMail).toHaveBeenCalledTimes(3);
    expect(mockEmailCounterAdd).not.toHaveBeenCalled();
  });

  test("counts one failure after exhausting the retries", async () => {
    EmailQueueSettings.retryBaseDelayMs = 1;
    EmailQueueSetTransport({ sendMail: mockSendMail }, "noreply@example.com", "");
    mockSendMail.mockRejectedValue(new Error("smtp down"));
    EmailQueueEnqueue({ notification: notification(), recipient: "user@example.com" });
    await EmailQueueWaitForIdle();

    expect(mockSendMail).toHaveBeenCalledTimes(EmailQueueSettings.maxAttempts);
    expect(mockEmailCounterAdd).toHaveBeenCalledWith(1);
  });

  test("times out a hung send and retries successfully", async () => {
    EmailQueueSettings.retryBaseDelayMs = 1;
    EmailQueueSettings.sendTimeoutMs = 20;
    EmailQueueSetTransport({ sendMail: mockSendMail }, "noreply@example.com", "");
    mockSendMail.mockImplementationOnce(
      () => new Promise(() => {}), // never resolves
    );
    EmailQueueEnqueue({ notification: notification(), recipient: "user@example.com" });
    await EmailQueueWaitForIdle();

    expect(mockSendMail).toHaveBeenCalledTimes(2);
    expect(mockEmailCounterAdd).not.toHaveBeenCalled();
  });

  test("drops jobs when the queue is full", async () => {
    EmailQueueSetTransport({ sendMail: mockSendMail }, "noreply@example.com", "");
    let resolvedSends = 0;
    const resolvers = [];
    mockSendMail.mockImplementation(
      () =>
        new Promise((resolve) =>
          resolvers.push(() => {
            resolvedSends += 1;
            resolve();
          }),
        ),
    );
    EmailQueueSettings.maxQueueSize = 2;
    for (let i = 0; i < 4; i += 1) {
      EmailQueueEnqueue({
        notification: notification({ id: `notification-${i}` }),
        recipient: "user@example.com",
      });
    }
    while (resolvers.length > 0) {
      const batch = resolvers.splice(0);
      batch.forEach((resolve) => resolve());
      await new Promise((r) => setImmediate(r));
    }
    await EmailQueueWaitForIdle();

    // The queue holds 2 jobs while the first is in flight, so 3 jobs are
    // delivered and the 4th is dropped and counted.
    expect(resolvedSends).toBe(3);
    expect(mockEmailCounterAdd).toHaveBeenCalledWith(1);
  });

  test("delivers every queued job across the concurrency workers", async () => {
    EmailQueueSetTransport({ sendMail: mockSendMail }, "noreply@example.com", "");
    const jobCount = EmailQueueSettings.concurrency * 2;
    for (let i = 0; i < jobCount; i += 1) {
      EmailQueueEnqueue({
        notification: notification({ id: `notification-${i}` }),
        recipient: "user@example.com",
      });
    }
    await EmailQueueWaitForIdle();
    expect(mockSendMail).toHaveBeenCalledTimes(jobCount);
  });
});

describe("transport creation", () => {
  test("creates an SMTP transport from the config", () => {
    nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });
    const transport = CreateTransportFromConfig({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: 465,
      SMTP_SECURE: true,
      SMTP_USER: "user",
      SMTP_PASSWORD: "pass",
      SMTP_FROM: "noreply@example.com",
    });
    expect(transport).toBeDefined();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 465,
        secure: true,
        auth: { user: "user", pass: "pass" },
      }),
    );
  });

  test("omits auth when no SMTP user is configured", () => {
    nodemailer.createTransport.mockReturnValue({ sendMail: mockSendMail });
    CreateTransportFromConfig({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      SMTP_FROM: "noreply@example.com",
    });
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  test("returns undefined when SMTP is not configured", () => {
    expect(CreateTransportFromConfig({ SMTP_HOST: "", SMTP_FROM: "" })).toBeUndefined();
    expect(
      CreateTransportFromConfig({ SMTP_HOST: "smtp.example.com", SMTP_FROM: "" }),
    ).toBeUndefined();
  });
});

describe("escapeHtml", () => {
  test("escapes the dangerous characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});
