jest.mock("../dist/users/Auth", () => ({
  AuthGetUserSession: jest.fn().mockResolvedValue({
    isAuthenticated: false,
    userId: null,
  }),
}));
jest.mock("../dist/apitokens/ApiTokensData", () => ({
  ApiTokensList: jest.fn().mockResolvedValue([]),
  ApiTokensCreate: jest.fn().mockResolvedValue({
    id: "token-id",
    name: "Client",
    token: "plaintext",
  }),
  ApiTokensDelete: jest.fn().mockResolvedValue(1),
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
const {
  ApiTokensCreate,
  ApiTokensDelete,
} = require("../dist/apitokens/ApiTokensData");
const { ApiTokensRoutes } = require("../dist/apitokens/ApiTokensRoutes");

describe("API token routes", () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
    AuthGetUserSession.mockResolvedValue({
      isAuthenticated: false,
      userId: null,
    });
    ApiTokensDelete.mockResolvedValue(1);
    app = Fastify();
    await app.register(new ApiTokensRoutes().getRoutes, { prefix: "/tokens" });
    await app.ready();
  });

  afterEach(async () => app.close());

  test("returns 401 for missing sessions", async () => {
    const list = await app.inject({ method: "GET", url: "/tokens" });
    expect(list.statusCode).toBe(401);
    const create = await app.inject({
      method: "POST",
      url: "/tokens",
      payload: { name: "Client" },
    });
    expect(create.statusCode).toBe(401);
    const remove = await app.inject({ method: "DELETE", url: "/tokens/id" });
    expect(remove.statusCode).toBe(401);
  });

  test("returns 400 (not 500) for a body-less token creation", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    const response = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { authorization: "Bearer session" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Missing: name");

    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    const blank = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { authorization: "Bearer session" },
      payload: { name: "  " },
    });
    expect(blank.statusCode).toBe(400);
  });

  test("enforces the 200-character token name limit", async () => {
    // SQLite ignores VARCHAR(200) while Postgres rejects longer values, so the
    // API is the enforcement point for both backends.
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    const atLimit = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { authorization: "Bearer session" },
      payload: { name: "a".repeat(200) },
    });
    expect(atLimit.statusCode).toBe(201);
    expect(ApiTokensCreate).toHaveBeenCalledWith(undefined, "a".repeat(200));

    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    const tooLong = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { authorization: "Bearer session" },
      payload: { name: "a".repeat(201) },
    });
    expect(tooLong.statusCode).toBe(400);
    expect(JSON.parse(tooLong.body)).toEqual({ error: "Invalid: name" });
    expect(ApiTokensCreate).toHaveBeenCalledTimes(1);

    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    const trimmed = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { authorization: "Bearer session" },
      payload: { name: "  Client  " },
    });
    expect(trimmed.statusCode).toBe(201);
    expect(ApiTokensCreate).toHaveBeenLastCalledWith(undefined, "Client");
  });

  test("returns 404 when deleting a token that does not exist", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    ApiTokensDelete.mockResolvedValueOnce(0);
    const missing = await app.inject({
      method: "DELETE",
      url: "/tokens/missing",
      headers: { authorization: "Bearer session" },
    });
    expect(missing.statusCode).toBe(404);

    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "admin",
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: "/tokens/token-id",
      headers: { authorization: "Bearer session" },
    });
    expect(deleted.statusCode).toBe(200);
  });
});
