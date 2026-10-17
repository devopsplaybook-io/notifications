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
jest.mock("uuid", () => {
  let counter = 0;
  return { v4: () => `mock-uuid-${(counter += 1)}` };
});

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DbUtilsInit,
  DbUtilsSetOTel,
} = require("@devopsplaybook.io/common-utils");
const {
  EmailRulesCreate,
  EmailRulesDelete,
  EmailRulesGet,
  EmailRulesList,
  EmailRulesMatching,
  EmailRulesUpdate,
} = require("../dist/emails/EmailRulesData");

const sqlDir = path.resolve(__dirname, "../sql/sqlite");
const span = undefined;

// The real DB layer requires an injected tracer/logger; a stub is enough here.
DbUtilsSetOTel(
  {
    startSpan: () => ({
      addEvent: jest.fn(),
      setAttributes: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
    }),
  },
  {
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
);

async function createDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notifications-email-rules-"));
  await DbUtilsInit(span, { DATABASE_TYPE: "sqlite", DATA_DIR: directory }, sqlDir);
}

async function insertRule(source, severity, recipient, severityMode) {
  return EmailRulesCreate(span, source, severity, recipient, severityMode);
}

describe("email rules data (sqlite)", () => {
  beforeEach(async () => {
    await createDatabase();
  });

  test("matches rules case-insensitively with source/severity wildcards", async () => {
    await insertRule("", "", "any-recipient@example.com");
    await insertRule("fluxcd", "", "flux-recipient@example.com");
    await insertRule("", "error", "errors-recipient@example.com");
    await insertRule("GitHub", "Error", "exact-recipient@example.com");
    await insertRule("other", "error", "other-recipient@example.com");

    const recipientsFor = async (source, severity) =>
      (await EmailRulesMatching(span, source, severity)).map((rule) => rule.recipient);

    // Everything matches an "any/any" rule
    expect(await recipientsFor("fluxcd", "error")).toContain("any-recipient@example.com");

    // Source wildcard: all errors from any service
    expect(await recipientsFor("anything", "error")).toEqual(
      expect.arrayContaining(["any-recipient@example.com", "errors-recipient@example.com"]),
    );
    expect(await recipientsFor("anything", "error")).not.toContain("flux-recipient@example.com");

    // Severity wildcard: everything from one service, case-insensitively
    expect(await recipientsFor("FLUXCD", "info")).toEqual(
      expect.arrayContaining(["any-recipient@example.com", "flux-recipient@example.com"]),
    );

    // Exact service+severity, case-insensitive on both sides
    expect(await recipientsFor("github", "error")).toEqual(
      expect.arrayContaining([
        "any-recipient@example.com",
        "errors-recipient@example.com",
        "exact-recipient@example.com",
      ]),
    );
    expect(await recipientsFor("github", "error")).not.toContain("other-recipient@example.com");

    // Severity is matched exactly, not as a prefix or threshold
    expect(await recipientsFor("github", "errors")).not.toContain("exact-recipient@example.com");
    expect(await recipientsFor("github", "success")).not.toContain("exact-recipient@example.com");
  });

  test("round-trips rules through create, list, get, update and delete", async () => {
    const created = await insertRule("fluxcd", "error", "user@example.com");
    expect(created.id).toBeTruthy();
    expect(created.severityMode).toBe("exact");

    const listed = await EmailRulesList(span);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: created.id,
      source: "fluxcd",
      severity: "error",
      severityMode: "exact",
      recipient: "user@example.com",
    });

    await expect(EmailRulesGet(span, created.id)).resolves.toMatchObject({
      recipient: "user@example.com",
      severityMode: "exact",
    });
    await expect(EmailRulesGet(span, "missing")).resolves.toBeUndefined();

    await expect(
      EmailRulesUpdate(span, created.id, "", "warning", "other@example.com"),
    ).resolves.toBe(true);
    await expect(EmailRulesGet(span, created.id)).resolves.toMatchObject({
      source: "",
      severity: "warning",
      severityMode: "exact",
      recipient: "other@example.com",
    });
    await expect(
      EmailRulesUpdate(span, created.id, "", "warning", "other@example.com", "threshold"),
    ).resolves.toBe(true);
    await expect(EmailRulesGet(span, created.id)).resolves.toMatchObject({
      severity: "warning",
      severityMode: "threshold",
    });
    await expect(
      EmailRulesUpdate(span, "missing", "", "warning", "other@example.com"),
    ).resolves.toBe(false);

    await expect(EmailRulesDelete(span, created.id)).resolves.toBe(1);
    await expect(EmailRulesList(span)).resolves.toHaveLength(0);
    await expect(EmailRulesDelete(span, "missing")).resolves.toBe(0);
  });

  test("threshold rules match their severity and everything above it", async () => {
    await insertRule("", "warning", "warn-threshold@example.com", "threshold");
    await insertRule("", "error", "error-threshold@example.com", "threshold");
    await insertRule("", "warning", "warn-exact@example.com");

    const recipientsFor = async (source, severity) =>
      (await EmailRulesMatching(span, source, severity)).map((rule) => rule.recipient);

    // "warning and above" catches warnings and errors
    expect(await recipientsFor("anything", "warning")).toEqual(
      expect.arrayContaining(["warn-threshold@example.com", "warn-exact@example.com"]),
    );
    expect(await recipientsFor("anything", "error")).toEqual(
      expect.arrayContaining(["warn-threshold@example.com", "error-threshold@example.com"]),
    );
    expect(await recipientsFor("anything", "error")).not.toContain("warn-exact@example.com");

    // info/success never satisfy a threshold
    expect(await recipientsFor("anything", "info")).toEqual([]);
    expect(await recipientsFor("anything", "success")).toEqual([]);

    // unknown producer severities never satisfy a threshold either
    expect(await recipientsFor("anything", "critical")).toEqual([]);

    // the threshold base is matched case-insensitively
    await insertRule("", "ERROR", "upper@example.com", "threshold");
    expect(await recipientsFor("anything", "error")).toContain("upper@example.com");
  });

  test("error threshold rules match errors only and exact rules keep working", async () => {
    await insertRule("", "error", "error-threshold@example.com", "threshold");
    await insertRule("fluxcd", "error", "flux-exact@example.com");

    const recipientsFor = async (source, severity) =>
      (await EmailRulesMatching(span, source, severity)).map((rule) => rule.recipient);

    expect(await recipientsFor("fluxcd", "error")).toEqual(
      expect.arrayContaining(["error-threshold@example.com", "flux-exact@example.com"]),
    );
    expect(await recipientsFor("fluxcd", "warning")).toEqual([]);
    expect(await recipientsFor("other", "error")).toEqual(
      expect.arrayContaining(["error-threshold@example.com"]),
    );
    expect(await recipientsFor("other", "error")).not.toContain("flux-exact@example.com");
  });

  test("threshold rules with an empty severity stay the any-severity wildcard", async () => {
    await insertRule("", "", "empty-threshold@example.com", "threshold");
    for (const severity of ["info", "success", "warning", "error", "unknown"]) {
      expect(await EmailRulesMatching(span, "anything", severity)).toEqual([
        expect.objectContaining({
          recipient: "empty-threshold@example.com",
          severityMode: "threshold",
        }),
      ]);
    }
  });

  test("allows several rules with the same recipient", async () => {
    await insertRule("", "", "user@example.com");
    await insertRule("fluxcd", "error", "user@example.com");
    await expect(EmailRulesList(span)).resolves.toHaveLength(2);
  });
});
