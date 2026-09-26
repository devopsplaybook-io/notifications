jest.mock("uuid", () => ({ v4: () => "mock-uuid" }));
jest.mock("@devopsplaybook.io/common-utils", () => ({
  DbUtilsExecSQL: jest.fn(),
  DbUtilsQuerySQL: jest.fn(),
}));
jest.mock("../dist/OTelContext", () => ({
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  OTelLogger: () => ({ createModuleLogger: () => ({ info: jest.fn() }) }),
}));

const { createHash } = require("crypto");
const {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} = require("@devopsplaybook.io/common-utils");
const {
  ApiTokensList,
  ApiTokensCreate,
  ApiTokensMigrateToHashed,
  ApiTokensValidate,
} = require("../dist/apitokens/ApiTokensData");

describe("API token storage", () => {
  test("migrates existing plaintext tokens idempotently", async () => {
    const tokens = [
      { id: "legacy", token: "legacy-client-token" },
      { id: "migrated", token: "sha256:already-hashed" },
    ];
    DbUtilsQuerySQL.mockImplementation(async (_span, query) =>
      query.includes("SELECT id, token") ? tokens : [],
    );
    DbUtilsExecSQL.mockImplementation(async (_span, _query, [token, id]) => {
      tokens.find((row) => row.id === id).token = token;
      return 1;
    });
    await ApiTokensMigrateToHashed(undefined);
    expect(tokens[0].token).toBe(
      `sha256:${createHash("sha256").update("legacy-client-token").digest("hex")}`,
    );
    expect(tokens[1].token).toBe("sha256:already-hashed");
    expect(DbUtilsExecSQL).toHaveBeenCalledTimes(1);
  });

  test("validates by hash and omits secrets from the token list", async () => {
    const secret = "client-token";
    const expectedHash = `sha256:${createHash("sha256").update(secret).digest("hex")}`;
    DbUtilsQuerySQL.mockImplementation(async (_span, query) =>
      query.includes("SELECT id, name")
        ? [{ id: "token-id", name: "Client", createdAt: "2026-09-26" }]
        : [{}],
    );
    expect(await ApiTokensValidate(undefined, secret)).toBe(true);
    expect(DbUtilsQuerySQL).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("token = ?"),
      [expectedHash],
    );
    expect(await ApiTokensList(undefined)).toEqual([
      { id: "token-id", name: "Client", createdAt: "2026-09-26" },
    ]);
    expect(DbUtilsQuerySQL.mock.calls[1][1]).not.toContain("token,");
  });

  test("returns a new plaintext token once while storing only its hash", async () => {
    DbUtilsExecSQL.mockResolvedValueOnce(1);
    const result = await ApiTokensCreate(undefined, "Build integration");
    const storedHash = `sha256:${createHash("sha256").update(result.token).digest("hex")}`;
    expect(result.token).toBe("mock-uuid");
    expect(DbUtilsExecSQL).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("INSERT INTO api_tokens"),
      [result.id, "Build integration", storedHash, expect.any(String)],
    );
  });
});
