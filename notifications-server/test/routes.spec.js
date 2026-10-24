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
  NotificationsDataGet: jest.fn().mockResolvedValue(null),
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
  PushNormalizeUserAgent: jest.fn((userAgent) =>
    typeof userAgent === "string" ? userAgent.slice(0, 500) : "",
  ),
  PushSubscribe: jest.fn().mockResolvedValue(undefined),
  PushListSubscriptions: jest.fn().mockResolvedValue([]),
  PushUnsubscribe: jest.fn().mockResolvedValue(undefined),
  PushUnsubscribeById: jest.fn().mockResolvedValue(false),
}));

jest.mock("../dist/emails/EmailService", () => ({
  EmailEvaluateNotification: jest.fn().mockResolvedValue(undefined),
  EmailIsConfigured: jest.fn().mockReturnValue(false),
  EmailSendTest: jest.fn().mockResolvedValue(undefined),
}));

const Fastify = require("fastify");
const { AuthGetUserSession } = require("../dist/users/Auth");
const { ApiTokensValidate } = require("../dist/apitokens/ApiTokensData");
const notificationsData = require("../dist/notifications/NotificationsData");
const {
  PushSubscribe,
  PushListSubscriptions,
  PushUnsubscribe,
  PushUnsubscribeById,
} = require("../dist/notifications/PushService");
const { EmailEvaluateNotification } = require("../dist/emails/EmailService");
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
      "",
      "",
    );
    expect(notificationsData.NotificationsDataCount).toHaveBeenCalledWith(
      undefined,
      "",
      "all",
      "",
      "",
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
      "",
      "",
    );
  });

  test("passes the severity and search filters to the list and count queries", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/notifications?q=deploy&severity=error",
      headers: { authorization: "Bearer api-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(notificationsData.NotificationsDataList).toHaveBeenCalledWith(
      undefined,
      50,
      0,
      "",
      "all",
      "error",
      "deploy",
    );
    expect(notificationsData.NotificationsDataCount).toHaveBeenCalledWith(
      undefined,
      "",
      "all",
      "error",
      "deploy",
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

  test("evaluates email rules for created notifications without failing the API call", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/notifications",
      headers: { authorization: "Bearer api-token" },
      payload: { title: "Test" },
    });
    expect(response.statusCode).toBe(201);
    expect(EmailEvaluateNotification).toHaveBeenCalledTimes(1);
    expect(EmailEvaluateNotification.mock.calls[0][1].title).toBe("Test");

    EmailEvaluateNotification.mockRejectedValueOnce(new Error("rules db down"));
    const resilient = await app.inject({
      method: "POST",
      url: "/notifications",
      headers: { authorization: "Bearer api-token" },
      payload: { title: "Test" },
    });
    expect(resilient.statusCode).toBe(201);
  });

  test("returns a single notification for session and API token callers", async () => {
    const stored = { id: "notification-id", title: "Test", read: true };
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    notificationsData.NotificationsDataGet.mockResolvedValueOnce(stored);
    const withSession = await app.inject({
      method: "GET",
      url: "/notifications/notification-id",
      headers: { authorization: "Bearer session" },
    });
    expect(withSession.statusCode).toBe(200);
    expect(JSON.parse(withSession.body)).toEqual(stored);
    expect(notificationsData.NotificationsDataGet).toHaveBeenCalledWith(
      undefined,
      "notification-id",
    );

    notificationsData.NotificationsDataGet.mockResolvedValueOnce(stored);
    const withApiToken = await app.inject({
      method: "GET",
      url: "/notifications/notification-id",
      headers: { authorization: "Bearer api-token" },
    });
    expect(withApiToken.statusCode).toBe(200);
    expect(JSON.parse(withApiToken.body)).toEqual(stored);
  });

  test("returns 404 for an unknown notification id", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    const response = await app.inject({
      method: "GET",
      url: "/notifications/missing",
      headers: { authorization: "Bearer session" },
    });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error).toContain("not found");
  });

  test("still serves /sources now that a /:id route is registered, with unread counts", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    notificationsData.NotificationsDataSources.mockResolvedValueOnce([
      { source: "build", unread: 3 },
      { source: "deploy", unread: 0 },
    ]);
    const response = await app.inject({
      method: "GET",
      url: "/notifications/sources",
      headers: { authorization: "Bearer session" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      sources: ["build", "deploy"],
      unreadCounts: { build: 3, deploy: 0 },
    });
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
      ["GET", "/notifications/notification-id"],
      ["DELETE", "/notifications/notification-id"],
      ["DELETE", "/notifications"],
      ["PUT", "/notifications/read-all"],
      ["PUT", "/notifications/notification-id/read"],
      ["POST", "/push/subscribe"],
      ["DELETE", "/push/subscribe"],
      ["GET", "/push/subscriptions"],
      ["DELETE", "/push/subscriptions/subscription-id"],
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

  test("passes the delete-all filters to the data layer", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    notificationsData.NotificationsDataDeleteAll.mockResolvedValueOnce(2);
    const response = await app.inject({
      method: "DELETE",
      url: "/notifications?source=build&read=unread",
      headers: { authorization: "Bearer session" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ success: true, deleted: 2 });
    expect(notificationsData.NotificationsDataDeleteAll).toHaveBeenCalledWith(
      undefined,
      "build",
      "unread",
      "",
      "",
    );
  });

  test("delete-all without filters deletes every notification", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/notifications",
      headers: { authorization: "Bearer session" },
    });
    expect(response.statusCode).toBe(200);
    expect(notificationsData.NotificationsDataDeleteAll).toHaveBeenCalledWith(
      undefined,
      "",
      "all",
      "",
      "",
    );
  });

  test("scopes read-all and delete-all to the severity and search filters", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    const readAll = await app.inject({
      method: "PUT",
      url: "/notifications/read-all?severity=error&q=deploy",
      headers: { authorization: "Bearer session" },
    });
    expect(readAll.statusCode).toBe(200);
    expect(notificationsData.NotificationsDataUpdateReadAll).toHaveBeenCalledWith(
      undefined,
      "",
      "all",
      "error",
      "deploy",
    );

    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    const deleteAll = await app.inject({
      method: "DELETE",
      url: "/notifications?severity=warning&q=100%25",
      headers: { authorization: "Bearer session" },
    });
    expect(deleteAll.statusCode).toBe(200);
    expect(notificationsData.NotificationsDataDeleteAll).toHaveBeenCalledWith(
      undefined,
      "",
      "all",
      "warning",
      "100%",
    );
  });

  test("rejects repeated filter query parameters with 400 instead of 500", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/notifications?source=a&source=b",
      headers: { authorization: "Bearer api-token" },
    });
    expect(list.statusCode).toBe(400);
    expect(JSON.parse(list.body)).toEqual({ error: "Invalid: source" });
    expect(notificationsData.NotificationsDataList).not.toHaveBeenCalled();

    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    const readAll = await app.inject({
      method: "PUT",
      url: "/notifications/read-all?q=a&q=b",
      headers: { authorization: "Bearer session" },
    });
    expect(readAll.statusCode).toBe(400);
    expect(JSON.parse(readAll.body)).toEqual({ error: "Invalid: q" });
    expect(
      notificationsData.NotificationsDataUpdateReadAll,
    ).not.toHaveBeenCalled();

    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    const deleteAll = await app.inject({
      method: "DELETE",
      url: "/notifications?source=a&source=b",
      headers: { authorization: "Bearer session" },
    });
    expect(deleteAll.statusCode).toBe(400);
    expect(JSON.parse(deleteAll.body)).toEqual({ error: "Invalid: source" });
    expect(notificationsData.NotificationsDataDeleteAll).not.toHaveBeenCalled();
  });

  test("trims query filters", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    const response = await app.inject({
      method: "DELETE",
      url: "/notifications?source=%20build%20&severity=%20error%20&q=%20deploy%20",
      headers: { authorization: "Bearer session" },
    });
    expect(response.statusCode).toBe(200);
    expect(notificationsData.NotificationsDataDeleteAll).toHaveBeenCalledWith(
      undefined,
      "build",
      "all",
      "error",
      "deploy",
    );
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
      headers: { authorization: "Bearer session", "user-agent": "test-agent/1.0" },
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
    expect(PushSubscribe).toHaveBeenCalledWith(
      undefined,
      "session-user",
      subscription,
      "test-agent/1.0",
    );
    expect(PushUnsubscribe).toHaveBeenCalledWith(
      undefined,
      subscription.endpoint,
    );
  });

  test("lists the push subscriptions of the session user", async () => {
    AuthGetUserSession.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "session-user",
    });
    PushListSubscriptions.mockResolvedValueOnce([
      {
        id: "sub-1",
        endpointOrigin: "https://push.example",
        userAgent: "agent/1.0",
        createdAt: "2026-01-01T00:00:00.000Z",
        endpointHash: "0123456789abcdef",
      },
    ]);
    const response = await app.inject({
      method: "GET",
      url: "/push/subscriptions",
      headers: { authorization: "Bearer session" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      subscriptions: [
        {
          id: "sub-1",
          endpointOrigin: "https://push.example",
          userAgent: "agent/1.0",
          createdAt: "2026-01-01T00:00:00.000Z",
          endpointHash: "0123456789abcdef",
        },
      ],
    });
    expect(PushListSubscriptions).toHaveBeenCalledWith(
      undefined,
      "session-user",
    );
  });

  test("revokes a push subscription by id and reports unknown or foreign ids", async () => {
    AuthGetUserSession
      .mockResolvedValueOnce({ isAuthenticated: true, userId: "session-user" })
      .mockResolvedValueOnce({ isAuthenticated: true, userId: "session-user" });
    PushUnsubscribeById
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const missing = await app.inject({
      method: "DELETE",
      url: "/push/subscriptions/unknown-id",
      headers: { authorization: "Bearer session" },
    });
    expect(missing.statusCode).toBe(404);
    expect(JSON.parse(missing.body).error).toContain("not found");

    const revoked = await app.inject({
      method: "DELETE",
      url: "/push/subscriptions/sub-1",
      headers: { authorization: "Bearer session" },
    });
    expect(revoked.statusCode).toBe(200);
    expect(JSON.parse(revoked.body)).toEqual({ success: true });
    expect(PushUnsubscribeById).toHaveBeenCalledWith(
      undefined,
      "session-user",
      "sub-1",
    );
  });
});
