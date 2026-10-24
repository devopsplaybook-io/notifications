const Database = require("better-sqlite3");
jest.mock("web-push", () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));
jest.mock("@devopsplaybook.io/common-utils", () => ({
  ConfigBase: class {},
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
  PushIsValidEndpoint,
  PushListSubscriptions,
  PushUnsubscribe,
  PushUnsubscribeById,
  PushEndpointHash,
  PushNormalizeUserAgent,
} = require("../dist/notifications/PushService");

const notification = {
  id: "notification-id",
  title: "Build",
  body: "Done",
  severity: "success",
  source: "ci",
  data: '{"run":4}',
};

function createDatabase() {
  const database = new Database(":memory:");
  database.exec(
    'CREATE TABLE push_subscriptions (id TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), "userId" TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, subscription TEXT NOT NULL, userAgent TEXT NOT NULL DEFAULT \'\', createdAt TEXT NOT NULL DEFAULT \'\')',
  );
  return database;
}

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

  test("keeps one row for concurrent same-user subscribes", async () => {
    const database = createDatabase();
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
    await expect(
      Promise.all([
        PushSubscribe(undefined, "user-a", first, "agent-a"),
        PushSubscribe(undefined, "user-a", second, "agent-a"),
      ]),
    ).resolves.toEqual([true, true]);

    const rows = database
      .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .all(endpoint);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("user-a");
    database.close();
  });

  test("rejects a cross-user endpoint takeover without touching the owner", async () => {
    const database = createDatabase();
    DbUtilsExecSQL.mockImplementation(async (_span, sql, params) =>
      database.prepare(sql).run(...params).changes,
    );

    const endpoint = "https://push.example/subscription";
    const first = {
      endpoint,
      keys: { p256dh: "key-a", auth: "auth-a" },
    };
    const second = {
      endpoint,
      keys: { p256dh: "key-b", auth: "auth-b" },
    };
    await expect(
      PushSubscribe(undefined, "user-a", first, "agent-a"),
    ).resolves.toBe(true);
    await expect(
      PushSubscribe(undefined, "user-b", second, "agent-b"),
    ).resolves.toBe(false);

    const rows = database
      .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .all(endpoint);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("user-a");
    expect(rows[0].subscription).toBe(JSON.stringify(first));
    expect(rows[0].userAgent).toBe("agent-a");
    database.close();
  });

  test("persists user agent and keeps the first subscribe date on upsert", async () => {
    const database = createDatabase();
    DbUtilsExecSQL.mockImplementation(async (_span, sql, params) =>
      database.prepare(sql).run(...params).changes,
    );

    const endpoint = "https://push.example/subscription";
    const subscription = {
      endpoint,
      keys: { p256dh: "key-a", auth: "auth-a" },
    };
    await expect(
      PushSubscribe(undefined, "user-a", subscription, "agent-first"),
    ).resolves.toBe(true);
    const firstRow = database
      .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .get(endpoint);
    expect(firstRow.userAgent).toBe("agent-first");
    expect(firstRow.createdAt).not.toBe("");

    await expect(
      PushSubscribe(undefined, "user-a", subscription, "agent-second"),
    ).resolves.toBe(true);
    const secondRow = database
      .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .get(endpoint);
    expect(secondRow.userAgent).toBe("agent-second");
    expect(secondRow.createdAt).toBe(firstRow.createdAt);
    database.close();
  });

  test("lists subscriptions scoped to the user with origin and endpoint hash", async () => {
    const database = createDatabase();
    const insert = database.prepare(
      "INSERT INTO push_subscriptions (id, \"userId\", endpoint, subscription, userAgent, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run(
      "sub-1",
      "user-a",
      "https://push.example/one",
      "{}",
      "agent-one",
      "2026-01-01T00:00:00.000Z",
    );
    insert.run(
      "sub-2",
      "user-b",
      "https://push.example/two",
      "{}",
      "agent-two",
      "2026-02-02T00:00:00.000Z",
    );
    insert.run(
      "sub-3",
      "user-a",
      "https://other.example/three",
      "{}",
      "agent-three",
      "2026-03-03T00:00:00.000Z",
    );
    DbUtilsQuerySQL.mockImplementation(async (_span, sql, params) =>
      database.prepare(sql).all(...params),
    );

    const entries = await PushListSubscriptions(undefined, "user-a");

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.id)).toEqual(["sub-3", "sub-1"]);
    expect(entries[0]).toEqual({
      id: "sub-3",
      endpointOrigin: "https://other.example",
      userAgent: "agent-three",
      createdAt: "2026-03-03T00:00:00.000Z",
      endpointHash: PushEndpointHash("https://other.example/three"),
    });
    expect(entries[1].endpointOrigin).toBe("https://push.example");
    expect(entries[1].endpointHash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(entries)).not.toContain("https://other.example/three");
    database.close();
  });

  test("unsubscribes by endpoint scoped to the owner", async () => {
    const database = createDatabase();
    DbUtilsExecSQL.mockImplementation(async (_span, sql, params) => {
      expect(sql).toContain('AND "userId" = ?');
      return database.prepare(sql).run(...params).changes;
    });
    const endpoint = "https://push.example/subscription";
    database
      .prepare(
        'INSERT INTO push_subscriptions (id, "userId", endpoint, subscription, userAgent, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run("sub-1", "user-a", endpoint, "{}", "", "");

    await expect(
      PushUnsubscribe(undefined, "user-b", endpoint),
    ).resolves.toBe(false);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
        .get().count,
    ).toBe(1);

    await expect(
      PushUnsubscribe(undefined, "user-a", endpoint),
    ).resolves.toBe(true);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
        .get().count,
    ).toBe(0);
    database.close();
  });

  test("unsubscribes by id scoped to the owner and reports missing deletes", async () => {
    const database = createDatabase();
    database
      .prepare(
        'INSERT INTO push_subscriptions (id, "userId", endpoint, subscription, userAgent, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run("sub-1", "user-a", "https://push.example/one", "{}", "", "");
    DbUtilsExecSQL.mockImplementation(async (_span, sql, params) =>
      database.prepare(sql).run(...params).changes,
    );

    await expect(
      PushUnsubscribeById(undefined, "user-b", "sub-1"),
    ).resolves.toBe(false);
    await expect(
      PushUnsubscribeById(undefined, "user-a", "missing"),
    ).resolves.toBe(false);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
        .get().count,
    ).toBe(1);

    await expect(PushUnsubscribeById(undefined, "user-a", "sub-1")).resolves.toBe(
      true,
    );
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM push_subscriptions")
        .get().count,
    ).toBe(0);
    database.close();
  });

  test("normalizes and truncates the user agent", () => {
    expect(PushNormalizeUserAgent("Mozilla/5.0")).toBe("Mozilla/5.0");
    expect(PushNormalizeUserAgent(undefined)).toBe("");
    expect(PushNormalizeUserAgent(42)).toBe("");
    expect(PushNormalizeUserAgent("a".repeat(600))).toHaveLength(500);
  });

  test("accepts only https endpoints on allowlisted push service hosts", () => {
    const accepted = [
      "https://fcm.googleapis.com/wp/registration-token",
      "https://updates.push.services.mozilla.com/wpush/v2/token",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
      "https://web.push.apple.com/QGVsbG8",
      "https://sub.push.apple.com/path",
    ];
    for (const endpoint of accepted) {
      expect({ endpoint, valid: PushIsValidEndpoint(endpoint) }).toEqual({
        endpoint,
        valid: true,
      });
    }

    const rejected = [
      "https://push.example/subscription",
      "https://127.0.0.1/push",
      "https://[::1]/push",
      "https://2130706433/push",
      "https://localhost/push",
      "https://fcm.googleapis.com.evil.example/push",
      "https://evil.example/fcm.googleapis.com",
      "http://fcm.googleapis.com/push",
      "https://user:pass@fcm.googleapis.com/push",
      "not-a-url",
    ];
    for (const endpoint of rejected) {
      expect({ endpoint, valid: PushIsValidEndpoint(endpoint) }).toEqual({
        endpoint,
        valid: false,
      });
    }
  });

  test("honours a custom push host allowlist", () => {
    PushInit({ PUSH_ALLOWED_HOSTS: "push.example,*.example.net" });
    try {
      expect(PushIsValidEndpoint("https://push.example/subscription")).toBe(
        true,
      );
      expect(PushIsValidEndpoint("https://a.example.net/subscription")).toBe(
        true,
      );
      expect(PushIsValidEndpoint("https://example.net/subscription")).toBe(
        false,
      );
      expect(PushIsValidEndpoint("https://fcm.googleapis.com/wp/token")).toBe(
        false,
      );
    } finally {
      PushInit({});
    }
  });
});
