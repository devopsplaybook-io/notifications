jest.mock("uuid", () => ({ v4: () => "mock-uuid" }));
jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(),
  verify: jest.fn(() => {
    throw new Error("expired");
  }),
}));
jest.mock("@devopsplaybook.io/common-utils", () => ({
  DbUtilsExecSQL: jest.fn().mockResolvedValue(1),
  DbUtilsQuerySQL: jest.fn().mockResolvedValue([]),
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

const { AuthGetUserSession, AuthInit, AuthValidateJWTKey } = require("../dist/users/Auth");
const { AuthRateLimit } = require("../dist/users/AuthRateLimit");
const { verify } = require("jsonwebtoken");

describe("authentication hardening", () => {
  test("rejects missing and weak JWT keys", () => {
    expect(() => AuthValidateJWTKey("")).toThrow();
    expect(() => AuthValidateJWTKey("dev")).toThrow();
    expect(() => AuthValidateJWTKey("a".repeat(31))).toThrow();
    expect(() => AuthValidateJWTKey("a".repeat(32))).toThrow();
    expect(() =>
      AuthValidateJWTKey("S0mething-long-random-Key-123456789012"),
    ).not.toThrow();
  });

  test("limits login attempts by username across client IPs", () => {
    const username = `rate-limit-${Date.now()}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        AuthRateLimit({ ip: `192.0.2.${attempt}` }, username, "login"),
      ).toBe(true);
    }
    expect(AuthRateLimit({ ip: "192.0.2.20" }, username, "login")    ).toBe(false);
  });

  test("treats opaque API bearer values as non-session credentials without JWT verification", async () => {
    await AuthInit(undefined, { JWT_KEY: "strong-signing-key-123456789012345" });
    const session = await AuthGetUserSession({
      headers: { authorization: "Bearer opaque-api-token" },
    });
    expect(session.isAuthenticated).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });

  test("limits registration attempts by IP across usernames", () => {
    const ip = `198.51.100.${Date.now() % 200}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        AuthRateLimit({ ip }, `registration-${attempt}`, "registration"),
      ).toBe(true);
    }
    expect(AuthRateLimit({ ip }, "registration-last", "registration")).toBe(
      false,
    );
  });
});
