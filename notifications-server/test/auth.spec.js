const mockAuthError = jest.fn();
const mockAuthWarn = jest.fn();
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
jest.mock("../dist/users/UsersData", () => ({
  UsersDataGet: jest.fn().mockResolvedValue(null),
}));
jest.mock("../dist/OTelContext", () => ({
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  mockAuthError,
  mockAuthWarn,
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: mockAuthWarn,
      error: mockAuthError,
    }),
  }),
}));

const {
  AUTH_RENEWAL_THRESHOLD_SECONDS,
  AuthGenerateJWT,
  AuthGetUserSession,
  AuthGetValidityDuration,
  AuthInit,
  AuthRenewSession,
  AuthValidateJWTKey,
} = require("../dist/users/Auth");
const { AuthRateLimit } = require("../dist/users/AuthRateLimit");
const { sign, verify } = require("jsonwebtoken");
const { UsersDataGet } = require("../dist/users/UsersData");
const authOtel = require("../dist/OTelContext");

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
    expect(authOtel.mockAuthError).not.toHaveBeenCalled();
    expect(authOtel.mockAuthWarn).not.toHaveBeenCalled();
  });

  test("logs invalid JWTs without an error stack", async () => {
    authOtel.mockAuthWarn.mockClear();
    authOtel.mockAuthError.mockClear();
    await AuthGetUserSession({
      headers: { authorization: "Bearer e30.e30.sig" },
    });
    expect(authOtel.mockAuthWarn).toHaveBeenCalledWith(
      "Invalid session token: Error",
    );
    expect(authOtel.mockAuthError).not.toHaveBeenCalled();
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

  test("accepts sessions whose token version matches the stored user", async () => {
    await AuthInit(undefined, { JWT_KEY: "strong-signing-key-123456789012345" });
    verify.mockReturnValueOnce({
      userId: "user-1",
      userName: "admin",
      tokenVersion: 2,
    });
    UsersDataGet.mockResolvedValueOnce({
      id: "user-1",
      name: "admin",
      tokenVersion: 2,
    });
    const session = await AuthGetUserSession({
      headers: { authorization: "Bearer aaa.bbb.ccc" },
    });
    expect(session).toEqual({ isAuthenticated: true, userId: "user-1" });
  });

  test("rejects sessions revoked by a password change or logout", async () => {
    await AuthInit(undefined, { JWT_KEY: "strong-signing-key-123456789012345" });
    authOtel.mockAuthWarn.mockClear();
    verify.mockReturnValueOnce({
      userId: "user-1",
      userName: "admin",
      tokenVersion: 2,
    });
    UsersDataGet.mockResolvedValueOnce({
      id: "user-1",
      name: "admin",
      tokenVersion: 3,
    });
    const session = await AuthGetUserSession({
      headers: { authorization: "Bearer aaa.bbb.ccc" },
    });
    expect(session.isAuthenticated).toBe(false);
    expect(authOtel.mockAuthWarn).toHaveBeenCalledWith(
      "Revoked or unknown session for user: admin",
    );
  });

  test("treats tokens without a version claim as version 0", async () => {
    await AuthInit(undefined, { JWT_KEY: "strong-signing-key-123456789012345" });
    verify.mockReturnValueOnce({ userId: "user-1", userName: "admin" });
    UsersDataGet.mockResolvedValueOnce({
      id: "user-1",
      name: "admin",
      tokenVersion: 0,
    });
    const legacySession = await AuthGetUserSession({
      headers: { authorization: "Bearer aaa.bbb.ccc" },
    });
    expect(legacySession).toEqual({ isAuthenticated: true, userId: "user-1" });

    verify.mockReturnValueOnce({ userId: "user-1", userName: "admin" });
    UsersDataGet.mockResolvedValueOnce({
      id: "user-1",
      name: "admin",
      tokenVersion: 1,
    });
    const revokedLegacySession = await AuthGetUserSession({
      headers: { authorization: "Bearer aaa.bbb.ccc" },
    });
    expect(revokedLegacySession.isAuthenticated).toBe(false);
  });

  test("renews old sessions only while the token version is current", async () => {
    await AuthInit(undefined, { JWT_KEY: "strong-signing-key-123456789012345" });
    const oldIssuedAt = Math.floor(Date.now() / 1000) - 48 * 60 * 60;
    verify.mockReturnValueOnce({
      iat: oldIssuedAt,
      userId: "user-1",
      userName: "admin",
      tokenVersion: 0,
    });
    UsersDataGet.mockResolvedValueOnce({
      id: "user-1",
      name: "admin",
      tokenVersion: 0,
    });
    sign.mockReturnValueOnce("renewed-token");
    const renewedHeader = jest.fn();
    await AuthRenewSession(
      { headers: { authorization: "Bearer aaa.bbb.ccc" } },
      { header: renewedHeader },
    );
    expect(renewedHeader).toHaveBeenCalledWith(
      "X-Renewed-Token",
      "renewed-token",
    );

    authOtel.mockAuthWarn.mockClear();
    verify.mockReturnValueOnce({
      iat: oldIssuedAt,
      userId: "user-1",
      userName: "admin",
      tokenVersion: 0,
    });
    UsersDataGet.mockResolvedValueOnce({
      id: "user-1",
      name: "admin",
      tokenVersion: 1,
    });
    const staleHeader = jest.fn();
    await AuthRenewSession(
      { headers: { authorization: "Bearer aaa.bbb.ccc" } },
      { header: staleHeader },
    );
    expect(staleHeader).not.toHaveBeenCalled();
    expect(authOtel.mockAuthWarn).toHaveBeenCalledWith(
      "Session renewal rejected for user: admin",
    );
  });
});

describe("session policy", () => {
  const policyConfig = () => ({
    JWT_KEY: "strong-signing-key-123456789012345",
    JWT_VALIDITY_DURATION: 2592000,
    JWT_SESSION_MAX_DURATION: 7776000,
  });

  test("the renewal threshold fires well inside the token lifetime", async () => {
    await AuthInit(undefined, policyConfig());

    expect(AuthGetValidityDuration()).toBe(2592000);
    expect(AUTH_RENEWAL_THRESHOLD_SECONDS).toBeGreaterThan(0);
    expect(AUTH_RENEWAL_THRESHOLD_SECONDS).toBeLessThan(
      AuthGetValidityDuration(),
    );
  });

  test("caps a renewed token at the absolute session lifetime", async () => {
    await AuthInit(undefined, policyConfig());
    const now = Math.floor(Date.now() / 1000);
    const sessionStartedAt = now - 80 * 24 * 60 * 60; // 80 days ago
    sign.mockClear();
    sign.mockReturnValueOnce("capped-token");

    await AuthGenerateJWT(
      { id: "user-1", name: "admin", tokenVersion: 0 },
      sessionStartedAt,
    );

    const payload = sign.mock.calls[0][0];
    expect(payload.sessionStartedAt).toBe(sessionStartedAt);
    expect(payload.exp).toBe(sessionStartedAt + 7776000);
    expect(payload.exp).toBeLessThan(now + 2592000);
  });

  test("rejects sessions past the absolute session lifetime", async () => {
    await AuthInit(undefined, policyConfig());
    authOtel.mockAuthWarn.mockClear();
    const sessionStartedAt = Math.floor(Date.now() / 1000) - 91 * 24 * 60 * 60;
    verify.mockReturnValueOnce({
      iat: sessionStartedAt,
      sessionStartedAt,
      userId: "user-1",
      userName: "admin",
      tokenVersion: 0,
    });
    UsersDataGet.mockResolvedValueOnce({
      id: "user-1",
      name: "admin",
      tokenVersion: 0,
    });

    const session = await AuthGetUserSession({
      headers: { authorization: "Bearer aaa.bbb.ccc" },
    });

    expect(session.isAuthenticated).toBe(false);
    expect(authOtel.mockAuthWarn).toHaveBeenCalledWith(
      "Session exceeded its absolute lifetime for user: admin",
    );
  });
});
