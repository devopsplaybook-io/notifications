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
jest.mock("../dist/users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
  AuthGenerateJWT: jest.fn().mockResolvedValue("session-token"),
}));
jest.mock("../dist/users/UsersData", () => ({
  UsersDataGet: jest.fn(),
}));
jest.mock("../dist/users/UserPassword", () => ({
  UserPasswordCheckPassword: jest.fn().mockResolvedValue(false),
}));
jest.mock("../dist/apitokens/ApiTokensData", () => ({
  ApiTokensValidate: jest.fn(),
}));

const Fastify = require("fastify");
const {
  LoginCodesRoutes,
  LoginCodeHashCode,
} = require("@devopsplaybook.io/common-utils/users/login-codes");
const { AuthGetUserSession } = require("../dist/users/Auth");
const { UsersDataGet } = require("../dist/users/UsersData");
const { ApiTokensValidate } = require("../dist/apitokens/ApiTokensData");
const {
  LoginCodesBuildRoutesOptions,
  LoginCodesRegister,
} = require("../dist/users/LoginCodes");

const JWT_KEY = "abcdefghijklmnopqrstuvwxyz0123456789";
const TEST_CODE = "BCDFGHJK";
const PREFIX = "/api/users/login-codes";

function configFor(enabled = true) {
  return {
    JWT_KEY,
    LOGIN_CODE_ENABLED: enabled,
    // Disable the per-route limits so the assertions cannot hit a 429.
    LOGIN_CODE_RATE_LIMIT_CREATE_MAX: 0,
    LOGIN_CODE_RATE_LIMIT_POLL_MAX: 0,
    LOGIN_CODE_RATE_LIMIT_APPROVE_MAX: 0,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
  };
}

function createStore({ available = true } = {}) {
  const now = Date.now();
  const record = {
    id: "request-1",
    requestTokenHash: "request-token-hash",
    codeHash: LoginCodeHashCode(TEST_CODE, JWT_KEY),
    previousCodeHash: null,
    codeExpiresAt: new Date(now + 30_000).toISOString(),
    previousCodeExpiresAt: null,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString(),
    approvedAt: null,
    approvedByUserId: null,
    consumedAt: null,
    attempts: 0,
    requestUserAgent: "test-agent",
  };
  return {
    record,
    available: jest.fn().mockResolvedValue(available),
    create: jest.fn(),
    getByRequestTokenHash: jest.fn().mockResolvedValue(null),
    getByCodeHash: jest
      .fn()
      .mockImplementation(async (hash) => (hash === record.codeHash ? record : null)),
    rotate: jest.fn(),
    approve: jest.fn().mockResolvedValue(true),
    consume: jest.fn(),
    cancel: jest.fn(),
    markExpired: jest.fn().mockResolvedValue(true),
    markFailed: jest.fn().mockResolvedValue(true),
    recordAttempt: jest.fn().mockResolvedValue(true),
    cleanup: jest.fn().mockResolvedValue(0),
  };
}

async function registerApp(options) {
  const app = Fastify();
  await app.register(
    async (instance) => {
      await LoginCodesRoutes(instance, options);
    },
    { prefix: PREFIX },
  );
  await app.ready();
  return app;
}

describe("login-code routes wiring", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    AuthGetUserSession.mockResolvedValue({ isAuthenticated: false, userId: null });
    ApiTokensValidate.mockResolvedValue(false);
    UsersDataGet.mockResolvedValue(null);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  test("capabilities report enabled and available from the store", async () => {
    const store = createStore();
    app = await registerApp(LoginCodesBuildRoutesOptions(configFor(), store));

    const available = await app.inject({ method: "GET", url: `${PREFIX}/capabilities` });
    expect(available.statusCode).toBe(200);
    expect(JSON.parse(available.body)).toMatchObject({ enabled: true, available: true });

    store.available.mockResolvedValue(false);
    const unavailable = await app.inject({
      method: "GET",
      url: `${PREFIX}/capabilities`,
    });
    expect(unavailable.statusCode).toBe(200);
    expect(JSON.parse(unavailable.body)).toMatchObject({
      enabled: true,
      available: false,
    });
  });

  test("refuses unauthenticated approval and preview with 401", async () => {
    const store = createStore();
    app = await registerApp(LoginCodesBuildRoutesOptions(configFor(), store));

    const approve = await app.inject({
      method: "POST",
      url: `${PREFIX}/approve`,
      payload: { code: TEST_CODE },
    });
    expect(approve.statusCode).toBe(401);
    expect(JSON.parse(approve.body).code).toBe("UNAUTHENTICATED");
    expect(store.approve).not.toHaveBeenCalled();

    const preview = await app.inject({
      method: "POST",
      url: `${PREFIX}/preview`,
      payload: { code: TEST_CODE },
    });
    expect(preview.statusCode).toBe(401);
    expect(JSON.parse(preview.body).code).toBe("UNAUTHENTICATED");
  });

  test("refuses approval and preview from an API token with 403", async () => {
    ApiTokensValidate.mockResolvedValue(true);
    const store = createStore();
    app = await registerApp(LoginCodesBuildRoutesOptions(configFor(), store));

    const headers = { authorization: "Bearer api-token-value" };
    const approve = await app.inject({
      method: "POST",
      url: `${PREFIX}/approve`,
      headers,
      payload: { code: TEST_CODE },
    });
    expect(approve.statusCode).toBe(403);
    expect(JSON.parse(approve.body).code).toBe("FORBIDDEN");
    expect(store.approve).not.toHaveBeenCalled();

    const preview = await app.inject({
      method: "POST",
      url: `${PREFIX}/preview`,
      headers,
      payload: { code: TEST_CODE },
    });
    expect(preview.statusCode).toBe(403);
    expect(JSON.parse(preview.body).code).toBe("FORBIDDEN");
  });

  test("approves a valid code for an interactive session and emits a safe event", async () => {
    AuthGetUserSession.mockResolvedValue({ isAuthenticated: true, userId: "user-1" });
    UsersDataGet.mockResolvedValue({ id: "user-1", name: "admin", tokenVersion: 0 });
    const store = createStore();
    const events = [];
    const options = {
      ...LoginCodesBuildRoutesOptions(configFor(), store),
      onEvent: (event) => events.push(event),
    };
    app = await registerApp(options);

    const response = await app.inject({
      method: "POST",
      url: `${PREFIX}/approve`,
      headers: { authorization: "Bearer session" },
      payload: { code: TEST_CODE },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ approved: true });
    expect(store.approve).toHaveBeenCalledTimes(1);
    expect(store.approve.mock.calls[0][0]).toMatchObject({
      approvedByUserId: "user-1",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "login_code_approved", userId: "user-1" });
    expect(JSON.stringify(events[0])).not.toContain(TEST_CODE);
    expect(events[0]).not.toHaveProperty("requestToken");
  });

  test("resolves the approving user for sessions, API tokens and anonymous callers", async () => {
    const options = LoginCodesBuildRoutesOptions(configFor(), createStore());

    AuthGetUserSession.mockResolvedValue({ isAuthenticated: true, userId: "user-1" });
    UsersDataGet.mockResolvedValue({ id: "user-1", name: "admin" });
    expect(
      await options.getApprovingUser({ headers: { authorization: "Bearer session" } }),
    ).toEqual({ id: "user-1", name: "admin" });

    AuthGetUserSession.mockResolvedValue({ isAuthenticated: false, userId: null });
    ApiTokensValidate.mockResolvedValue(true);
    expect(
      await options.getApprovingUser({ headers: { authorization: "Bearer api-token" } }),
    ).toEqual({ id: "", name: "", isApiToken: true });

    ApiTokensValidate.mockResolvedValue(false);
    expect(await options.getApprovingUser({ headers: {} })).toBeNull();
  });

  test("registers no routes while the feature flag is off", async () => {
    const disabled = Fastify();
    await LoginCodesRegister(disabled, configFor(false));
    await disabled.ready();
    const response = await disabled.inject({
      method: "GET",
      url: `${PREFIX}/capabilities`,
    });
    expect(response.statusCode).toBe(404);
    await disabled.close();

    const enabled = Fastify();
    await LoginCodesRegister(enabled, configFor(true));
    await enabled.ready();
    const capabilities = await enabled.inject({
      method: "GET",
      url: `${PREFIX}/capabilities`,
    });
    expect(capabilities.statusCode).toBe(200);
    await enabled.close();
  });
});
