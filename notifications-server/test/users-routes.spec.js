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
const { UserPasswordCheckUnknownUser } = require("../dist/users/UserPassword");
const { UsersDataGetByName, UsersDataList } = require("../dist/users/UsersData");
const { UsersRoutes } = require("../dist/users/UsersRoutes");

describe("user routes", () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
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
    expect(response.statusCode).toBe(403);
    expect(UserPasswordCheckUnknownUser).toHaveBeenCalledWith(
      undefined,
      "password",
    );
  });

  test("blocks account creation after the initial user exists, even for a session", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    UsersDataList.mockResolvedValueOnce([{ id: "admin" }]);
    const response = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "second-user", password: "password" },
    });
    expect(response.statusCode).toBe(403);
  });

  test("returns 401 when a valid session references a missing user", async () => {
    const { UsersDataGet } = require("../dist/users/UsersData");
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
});
