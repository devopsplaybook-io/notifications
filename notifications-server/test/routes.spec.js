jest.mock("../dist/users/Auth", () => ({
  AuthGetUserSession: jest.fn().mockResolvedValue({
    isAuthenticated: false,
    userId: null,
  }),
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

jest.mock("../dist/apitokens/ApiTokensData", () => ({
  ApiTokensValidate: jest.fn().mockResolvedValue(true),
}));

jest.mock("../dist/notifications/NotificationsData", () => ({
  NotificationsDataList: jest.fn().mockResolvedValue([]),
  NotificationsDataAdd: jest.fn(async (_span, notification) => ({
    ...notification,
    id: "notification-id",
  })),
  NotificationsDataCount: jest.fn().mockResolvedValue(12),
  NotificationsDataDelete: jest.fn().mockResolvedValue(false),
  NotificationsDataDeleteAll: jest.fn().mockResolvedValue(0),
  NotificationsDataSources: jest.fn().mockResolvedValue([]),
  NotificationsDataUpdateRead: jest.fn().mockResolvedValue(true),
  NotificationsDataUpdateReadAll: jest.fn().mockResolvedValue(0),
}));

jest.mock("../dist/notifications/PushService", () => ({
  PushSendToAll: jest.fn().mockResolvedValue(undefined),
  PushGetPublicKey: jest.fn().mockReturnValue("public-key"),
  PushIsValidEndpoint: jest.fn((endpoint) => {
    try {
      return new URL(endpoint).protocol === "https:";
    } catch {
      return false;
    }
  }),
  PushIsValidSubscription: jest.fn((subscription) =>
    Boolean(subscription?.endpoint && subscription?.keys?.p256dh && subscription?.keys?.auth),
  ),
  PushSubscribe: jest.fn().mockResolvedValue(undefined),
  PushUnsubscribe: jest.fn().mockResolvedValue(undefined),
}));

const Fastify = require("fastify");
const { AuthGetUserSession } = require("../dist/users/Auth");
const { ApiTokensValidate } = require("../dist/apitokens/ApiTokensData");
const notificationsData = require("../dist/notifications/NotificationsData");
const {
  PushSubscribe,
  PushUnsubscribe,
} = require("../dist/notifications/PushService");
const { NotificationsRoutes } = require("../dist/notifications/NotificationsRoutes");
const { PushRoutes } = require("../dist/notifications/PushRoutes");

describe("notification routes", () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
    AuthGetUserSession.mockResolvedValue({
      isAuthenticated: false,
      userId: null,
    });
    ApiTokensValidate.mockResolvedValue(true);
    app = Fastify();
    await app.register(new NotificationsRoutes().getRoutes, {
      prefix: "/notifications",
    });
    await app.register(new PushRoutes().getRoutes, { prefix: "/push" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test("clamps pagination and returns a numeric total", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/notifications?limit=-5&offset=-9",
      headers: { authorization: "Bearer api-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).total).toBe(12);
    expect(notificationsData.NotificationsDataList).toHaveBeenCalledWith(
      undefined,
      1,
      0,
      "",
      "all",
    );
  });

  test("caps large page sizes and preserves non-negative offsets", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/notifications?limit=5000&offset=17",
      headers: { authorization: "Bearer api-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(notificationsData.NotificationsDataList).toHaveBeenCalledWith(
      undefined,
      200,
      17,
      "",
      "all",
    );
  });

  test("accepts object and pre-encoded JSON data without double encoding", async () => {
    for (const data of [{ nested: true }, '{"nested":true}']) {
      const response = await app.inject({
        method: "POST",
        url: "/notifications",
        headers: { authorization: "Bearer api-token" },
        payload: { title: "Test", data },
      });
      expect(response.statusCode).toBe(201);
      expect(notificationsData.NotificationsDataAdd.mock.calls.at(-1)[1].data).toBe(
        '{"nested":true}',
      );
    }
  });

  test("rejects invalid notification data and reports missing deletes", async () => {
    const invalidData = await app.inject({
      method: "POST",
      url: "/notifications",
      headers: { authorization: "Bearer api-token" },
      payload: { title: "Test", data: "not-json" },
    });
    expect(invalidData.statusCode).toBe(400);
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    const missingDelete = await app.inject({
      method: "DELETE",
      url: "/notifications/missing",
      headers: { authorization: "Bearer session" },
    });
    expect(missingDelete.statusCode).toBe(404);
  });

  test("returns 400 (not 500) for body-less requests on protected routes", async () => {
    AuthGetUserSession.mockResolvedValue({
      isAuthenticated: true,
      userId: "session-user",
    });
    const readUpdate = await app.inject({
      method: "PUT",
      url: "/notifications/notification-id/read",
      headers: { authorization: "Bearer session" },
    });
    expect(readUpdate.statusCode).toBe(400);
    const pushSubscribe = await app.inject({
      method: "POST",
      url: "/push/subscribe",
      headers: { authorization: "Bearer session" },
    });
    expect(pushSubscribe.statusCode).toBe(400);
    const pushUnsubscribe = await app.inject({
      method: "DELETE",
      url: "/push/subscribe",
      headers: { authorization: "Bearer session" },
    });
    expect(pushUnsubscribe.statusCode).toBe(400);
  });

  test("caps the notification body at 10 KB and serialized data at 4 KB", async () => {
    const apiHeaders = { authorization: "Bearer api-token" };
    const oversizedBody = await app.inject({
      method: "POST",
      url: "/notifications",
      headers: apiHeaders,
      payload: { title: "Test", body: "a".repeat(10 * 1024 + 1) },
    });
    expect(oversizedBody.statusCode).toBe(400);
    expect(JSON.parse(oversizedBody.body).error).toContain("10 KB");

    const dataAtLimit = {
      d: "x".repeat(4 * 1024 - JSON.stringify({ d: "" }).length),
    };
    expect(Buffer.byteLength(JSON.stringify(dataAtLimit))).toBe(4 * 1024);
    const atLimit = await app.inject({
      method: "POST",
      url: "/notifications",
      headers: apiHeaders,
      payload: { title: "Test", body: "a".repeat(10 * 1024), data: dataAtLimit },
    });
    expect(atLimit.statusCode).toBe(201);

    const oversizedData = await app.inject({
      method: "POST",
      url: "/notifications",
      headers: apiHeaders,
      payload: { title: "Test", data: { d: "x".repeat(4 * 1024) } },
    });
    expect(oversizedData.statusCode).toBe(400);
    expect(JSON.parse(oversizedData.body).error).toContain("4 KB");
  });

  test("returns 401 for missing or invalid credentials", async () => {
    const unauthorizedRequests = [
      ["GET", "/notifications"],
      ["GET", "/notifications/sources"],
      ["DELETE", "/notifications/notification-id"],
      ["DELETE", "/notifications"],
      ["PUT", "/notifications/read-all"],
      ["PUT", "/notifications/notification-id/read"],
      ["POST", "/push/subscribe"],
      ["DELETE", "/push/subscribe"],
    ];
    for (const [method, url] of unauthorizedRequests) {
      const response = await app.inject({ method, url });
      expect({ method, url, status: response.statusCode }).toEqual({
        method,
        url,
        status: 401,
      });
    }

    ApiTokensValidate.mockResolvedValueOnce(false);
    const invalidToken = await app.inject({
      method: "GET",
      url: "/notifications",
      headers: { authorization: "Bearer invalid-token" },
    });
    expect(invalidToken.statusCode).toBe(401);

    ApiTokensValidate.mockResolvedValueOnce(false);
    const invalidProducer = await app.inject({
      method: "POST",
      url: "/notifications",
      headers: { authorization: "Bearer invalid-token" },
      payload: { title: "Test" },
    });
    expect(invalidProducer.statusCode).toBe(401);
  });

  test("rejects malformed push subscriptions with a client error", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    const response = await app.inject({
      method: "POST",
      url: "/push/subscribe",
      headers: { authorization: "Bearer session" },
      payload: { subscription: { endpoint: "not-an-endpoint" } },
    });
    expect(response.statusCode).toBe(400);
    expect(PushSubscribe).not.toHaveBeenCalled();
  });

  test("accepts a validated push subscription and supports unsubscribe", async () => {
    const subscription = {
      endpoint: "https://push.example/subscription",
      keys: { p256dh: "public-key", auth: "authentication-key" },
    };
    AuthGetUserSession
      .mockResolvedValueOnce({ isAuthenticated: true, userId: "session-user" })
      .mockResolvedValueOnce({ isAuthenticated: true, userId: "session-user" });
    const subscribed = await app.inject({
      method: "POST",
      url: "/push/subscribe",
      headers: { authorization: "Bearer session" },
      payload: { subscription },
    });
    const unsubscribed = await app.inject({
      method: "DELETE",
      url: "/push/subscribe",
      headers: { authorization: "Bearer session" },
      payload: { endpoint: subscription.endpoint },
    });
    expect(subscribed.statusCode).toBe(201);
    expect(unsubscribed.statusCode).toBe(200);
    expect(PushSubscribe).toHaveBeenCalled();
    expect(PushUnsubscribe).toHaveBeenCalledWith(
      undefined,
      subscription.endpoint,
    );
  });
});
