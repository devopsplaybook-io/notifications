jest.mock("../dist/OTelContext", () => ({
  OTelRequestSpan: () => undefined,
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  OTelLogger: () => ({
    createModuleLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }),
}));
jest.mock("../dist/users/UsersData", () => ({
  UsersDataGet: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const { AuthInit, AuthGetUserSession } = require("../dist/users/Auth");
const { UsersDataGet } = require("../dist/users/UsersData");
const { LoginCodesBuildRoutesOptions } = require("../dist/users/LoginCodes");

const JWT_KEY = "abcdefghijklmnopqrstuvwxyz0123456789";
const config = {
  JWT_KEY,
  LOGIN_CODE_ENABLED: true,
  JWT_VALIDITY_DURATION: 2592000,
  JWT_SESSION_MAX_DURATION: 7776000,
};

function createStore() {
  return { available: jest.fn().mockResolvedValue(true) };
}

describe("login-code issued sessions", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AuthInit(undefined, config);
  });

  test("issues the same JWT the password login accepts", async () => {
    UsersDataGet.mockResolvedValue({
      id: "user-1",
      name: "admin",
      tokenVersion: 0,
      passwordEncrypted: "hash",
    });
    const options = LoginCodesBuildRoutesOptions(config, createStore());

    const session = await options.issueSession({ id: "user-1", name: "admin" }, {});

    const payload = jwt.verify(session.token, JWT_KEY);
    expect(payload).toMatchObject({
      userId: "user-1",
      userName: "admin",
      tokenVersion: 0,
    });
    expect(session.user).toEqual({ id: "user-1", name: "admin" });
    expect(session.user).not.toHaveProperty("passwordEncrypted");

    const resolved = await AuthGetUserSession({
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(resolved).toEqual({ isAuthenticated: true, userId: "user-1" });
  });

  test("fails the redemption closed when the approver no longer exists", async () => {
    UsersDataGet.mockResolvedValue(null);
    const options = LoginCodesBuildRoutesOptions(config, createStore());

    await expect(
      options.issueSession({ id: "deleted-user", name: "gone" }, {}),
    ).rejects.toThrow("Login code approver no longer exists");
  });
});
