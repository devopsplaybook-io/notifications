const Database = require("better-sqlite3");
jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));
jest.mock("@devopsplaybook.io/common-utils", () => ({
  DbUtilsExecSQL: jest.fn().mockResolvedValue(1),
  DbUtilsQuerySQL: jest.fn(),
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
jest.mock("../dist/push/PushQueue", () => ({
  PushQueueEnqueue: jest.fn(),
}));

const {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
} = require("@devopsplaybook.io/common-utils");
const { PushQueueEnqueue } = require("../dist/push/PushQueue");
const {
  PushInit,
  PushSendToAll,
  PushSubscribe,
  PushUnsubscribe,
} = require("../dist/notifications/PushService");

const notification = {
  id: "notification-id",
  title: "Build",
  body: "Done",
  severity: "success",
  source: "ci",
  data: '{"run":4}',
};

describe("push service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    DbUtilsExecSQL.mockReset();
    DbUtilsQuerySQL.mockReset();
    DbUtilsExecSQL.mockResolvedValue(1);
    DbUtilsQuerySQL.mockResolvedValue([]);
  });

  test("enqueues fan-out when VAPID keys are configured", async () => {
    PushInit({
      VAPID_PUBLIC_KEY: "public",
      VAPID_PRIVATE_KEY: "private",
      VAPID_SUBJECT: "mailto:test@example.com",
    });
    await PushSendToAll(notification);
    expect(PushQueueEnqueue).toHaveBeenCalledWith(notification);
  });

  test("skips fan-out without VAPID keys", async () => {
    PushInit({ VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" });
    await PushSendToAll(notification);
    expect(PushQueueEnqueue).not.toHaveBeenCalled();
  });

  test("subscribes with an atomic upsert so concurrent calls keep one row", async () => {
    const database = new Database(":memory:");
    database.exec(
      'CREATE TABLE push_subscriptions ("userId" TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, subscription TEXT NOT NULL)',
    );
    DbUtilsExecSQL.mockImplementation(async (_span, sql, params) => {
      expect(sql).toContain("ON CONFLICT(endpoint) DO UPDATE");
      return database.prepare(sql).run(...params).changes;
    });

    const endpoint = "https://push.example/subscription";
    const first = {
      endpoint,
      keys: { p256dh: "key-a", auth: "auth-a" },
    };
    const second = {
      endpoint,
      keys: { p256dh: "key-b", auth: "auth-b" },
    };
    await Promise.all([
      PushSubscribe(undefined, "user-a", first),
      PushSubscribe(undefined, "user-b", second),
    ]);

    const rows = database
      .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .all(endpoint);
    expect(rows).toHaveLength(1);
    expect(["user-a", "user-b"]).toContain(rows[0].userId);
    expect([first, second].map((sub) => JSON.stringify(sub))).toContain(
      rows[0].subscription,
    );

    await PushSubscribe(undefined, "user-a", second);
    const updated = database
      .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .all(endpoint);
    expect(updated).toHaveLength(1);
    expect(updated[0].userId).toBe("user-a");
    expect(updated[0].subscription).toBe(JSON.stringify(second));
    database.close();
  });

  test("unsubscribes by endpoint", async () => {
    await PushUnsubscribe(undefined, "https://push.example/subscription");
    expect(DbUtilsExecSQL).toHaveBeenCalledWith(
      expect.anything(),
      "DELETE FROM push_subscriptions WHERE endpoint = ?",
      ["https://push.example/subscription"],
    );
  });
});
