jest.mock("../dist/users/Auth", () => ({
  AuthGetUserSession: jest.fn().mockResolvedValue({
    isAuthenticated: false,
    userId: null,
  }),
  AuthGenerateJWT: jest.fn().mockResolvedValue("session-token"),
}));
jest.mock("../dist/users/AuthRateLimit", () => ({
  AuthRateLimit: jest.fn().mockReturnValue(true),
}));
jest.mock("../dist/users/UserPassword", () => ({
  UserPasswordCheckPassword: jest.fn().mockResolvedValue(false),
  UserPasswordCheckUnknownUser: jest.fn().mockResolvedValue(undefined),
  UserPasswordSetPassword: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../dist/users/UsersData", () => ({
  UsersDataAdd: jest.fn().mockResolvedValue(undefined),
  UsersDataBumpTokenVersion: jest.fn().mockResolvedValue(undefined),
  UsersDataGet: jest.fn(),
  UsersDataGetByName: jest.fn(),
  UsersDataList: jest.fn(),
  UsersDataUpdate: jest.fn().mockResolvedValue(undefined),
}));
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

const Fastify = require("fastify");
const { AuthGetUserSession } = require("../dist/users/Auth");
const { AuthRateLimit } = require("../dist/users/AuthRateLimit");
const { UserPasswordCheckUnknownUser } = require("../dist/users/UserPassword");
const {
  UsersDataBumpTokenVersion,
  UsersDataGet,
  UsersDataGetByName,
  UsersDataList,
} = require("../dist/users/UsersData");
const { UsersRoutes } = require("../dist/users/UsersRoutes");

describe("user routes", () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
    AuthRateLimit.mockReturnValue(true);
    AuthGetUserSession.mockResolvedValue({
      isAuthenticated: false,
      userId: null,
    });
    UsersDataGetByName.mockResolvedValue(null);
    UsersDataList.mockResolvedValue([]);
    app = Fastify();
    await app.register(new UsersRoutes().getRoutes, { prefix: "/users" });
    await app.ready();
  });

  afterEach(async () => app.close());

  test("performs a dummy bcrypt comparison for an unknown username", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users/session",
      payload: { name: "missing-user", password: "password" },
    });
    expect(response.statusCode).toBe(401);
    expect(UserPasswordCheckUnknownUser).toHaveBeenCalledWith(
      undefined,
      "password",
    );
  });

  test("returns initialization status with 200", async () => {
    UsersDataList.mockResolvedValueOnce([]);
    const fresh = await app.inject({
      method: "GET",
      url: "/users/status/initialization",
    });
    expect(fresh.statusCode).toBe(200);
    expect(JSON.parse(fresh.body)).toEqual({ initialized: false });

    UsersDataList.mockResolvedValueOnce([{ id: "admin" }]);
    const initialized = await app.inject({
      method: "GET",
      url: "/users/status/initialization",
    });
    expect(initialized.statusCode).toBe(200);
    expect(JSON.parse(initialized.body)).toEqual({ initialized: true });
  });

  test("returns 400 (not 500) for body-less session, password and registration requests", async () => {
    const session = await app.inject({ method: "POST", url: "/users/session" });
    expect(session.statusCode).toBe(400);
    expect(JSON.parse(session.body).error).toBe("Missing: Name");

    const password = await app.inject({ method: "PUT", url: "/users/password" });
    expect(password.statusCode).toBe(401);

    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    UsersDataGet.mockResolvedValueOnce({ id: "admin", name: "admin" });
    const authenticatedPassword = await app.inject({
      method: "PUT",
      url: "/users/password",
      headers: { authorization: "Bearer session" },
    });
    expect(authenticatedPassword.statusCode).toBe(400);

    const registration = await app.inject({ method: "POST", url: "/users" });
    expect(registration.statusCode).toBe(400);
    expect(JSON.parse(registration.body).error).toBe("Missing: Name");
  });

  test("does not consume the login rate limit for session refreshes", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    UsersDataGet.mockResolvedValueOnce({
      id: "admin",
      name: "admin",
      tokenVersion: 3,
    });
    const response = await app.inject({
      method: "POST",
      url: "/users/session",
      headers: { authorization: "Bearer session" },
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).token).toBe("session-token");
    expect(AuthRateLimit).not.toHaveBeenCalled();
  });

  test("blocks account creation after the initial user exists, even for a session", async () => {
    UsersDataList.mockResolvedValueOnce([{ id: "admin" }]);
    const response = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "second-user", password: "password" },
    });
    expect(response.statusCode).toBe(403);
  });

  test("returns 401 when a valid session references a missing user", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "deleted-user",
    });
    UsersDataGet.mockResolvedValueOnce(null);
    const response = await app.inject({
      method: "POST",
      url: "/users/session",
      payload: { name: "ignored", password: "ignored" },
    });
    expect(response.statusCode).toBe(401);
  });

  test("password change bumps the token version and issues a fresh token", async () => {
    const { UserPasswordCheckPassword, UserPasswordSetPassword } = require("../dist/users/UserPassword");
    UserPasswordCheckPassword.mockResolvedValueOnce(true);
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    UsersDataGet
      .mockResolvedValueOnce({ id: "admin", name: "admin", tokenVersion: 0 })
      .mockResolvedValueOnce({ id: "admin", name: "admin", tokenVersion: 1 });
    const response = await app.inject({
      method: "PUT",
      url: "/users/password",
      headers: { authorization: "Bearer session" },
      payload: { passwordOld: "old-password", password: "new-password" },
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).token).toBe("session-token");
    expect(UserPasswordSetPassword).toHaveBeenCalled();
    expect(UsersDataBumpTokenVersion).toHaveBeenCalledWith(undefined, "admin");
  });

  test("rejects a wrong old password without bumping the token version", async () => {
    const { UserPasswordCheckPassword } = require("../dist/users/UserPassword");
    UserPasswordCheckPassword.mockResolvedValueOnce(false);
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    UsersDataGet.mockResolvedValueOnce({ id: "admin", name: "admin" });
    const response = await app.inject({
      method: "PUT",
      url: "/users/password",
      headers: { authorization: "Bearer session" },
      payload: { passwordOld: "wrong", password: "new-password" },
    });
    expect(response.statusCode).toBe(403);
    expect(UsersDataBumpTokenVersion).not.toHaveBeenCalled();
  });

  test("logout revokes all sessions by bumping the token version", async () => {
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/users/logout",
    });
    expect(unauthenticated.statusCode).toBe(401);

    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    const response = await app.inject({
      method: "POST",
      url: "/users/logout",
      headers: { authorization: "Bearer session" },
    });
    expect(response.statusCode).toBe(200);
    expect(UsersDataBumpTokenVersion).toHaveBeenCalledWith(undefined, "admin");
  });
});
