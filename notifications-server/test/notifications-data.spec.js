const Database = require("better-sqlite3");
const mockDatabase = new Database(":memory:");
jest.mock("uuid", () => ({ v4: () => "generated-id" }));
jest.mock("@devopsplaybook.io/common-utils", () => ({
  DbUtilsExecSQL: jest.fn((_, query, parameters = []) =>
    mockDatabase.prepare(query).run(...parameters).changes,
  ),
  DbUtilsQuerySQL: jest.fn((_, query, parameters = []) =>
    mockDatabase.prepare(query).all(...parameters),
  ),
}));
jest.mock("../dist/OTelContext", () => ({
  OTelTracer: () => ({ startSpan: () => ({ end: jest.fn() }) }),
  OTelLogger: () => ({
    createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  }),
}));

const {
  DbUtilsQuerySQL,
} = require("@devopsplaybook.io/common-utils");
const {
  NotificationsDataAdd,
  NotificationsDataCount,
  NotificationsDataDelete,
  NotificationsDataDeleteAll,
  NotificationsDataGet,
  NotificationsDataList,
  NotificationsDataPrune,
  NotificationsDataSources,
  NotificationsDataUpdateReadAll,
} = require("../dist/notifications/NotificationsData");

describe("notification data operations", () => {
  beforeEach(() => {
    mockDatabase.exec("DROP TABLE IF EXISTS notifications");
    mockDatabase.exec(`
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source TEXT NOT NULL,
        severity TEXT NOT NULL,
        data TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        "read" INTEGER NOT NULL DEFAULT 0
      )
    `);
    jest.clearAllMocks();
  });

  afterAll(() => mockDatabase.close());

  test("adds, filters, and counts notification rows", async () => {
    const notification = {
      title: "New",
      body: "",
      source: "service",
      severity: "info",
      data: "{}",
      read: false,
    };
    const created = await NotificationsDataAdd(undefined, notification);
    expect(created.id).toBe("generated-id");
    const rows = await NotificationsDataList(
      undefined,
      10,
      0,
      "service",
      "unread",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].read).toBe(false);
    expect(await NotificationsDataCount(undefined, "service", "unread")).toBe(1);
  });

  test("normalizes Postgres count strings to numbers", async () => {
    DbUtilsQuerySQL.mockResolvedValueOnce([{ count: "23" }]);
    const count = await NotificationsDataCount(undefined);
    expect(count).toBe(23);
    expect(typeof count).toBe("number");
  });

  test("prunes notifications older than the configured cutoff", async () => {
    const insert = mockDatabase.prepare(
      'INSERT INTO notifications (id, title, body, source, severity, data, createdAt, "read") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run("old", "Old", "", "service", "info", "{}", "2026-01-01T00:00:00.000Z", 0);
    insert.run("recent", "Recent", "", "service", "info", "{}", "2026-09-25T00:00:00.000Z", 0);
    expect(
      await NotificationsDataPrune(undefined, "2026-06-28T00:00:00.000Z"),
    ).toBe(1);
    expect(await NotificationsDataCount(undefined)).toBe(1);
  });

  test("reports unknown notification deletes", async () => {
    expect(await NotificationsDataDelete(undefined, "missing")).toBe(false);
  });

  test("gets a stored notification with a normalized read flag", async () => {
    const created = await NotificationsDataAdd(undefined, {
      title: "Get me",
      body: "",
      source: "service",
      severity: "info",
      data: '{"run":4}',
      read: false,
    });
    const fetched = await NotificationsDataGet(undefined, created.id);
    expect(fetched.id).toBe("generated-id");
    expect(fetched.title).toBe("Get me");
    expect(fetched.data).toBe('{"run":4}');
    expect(fetched.read).toBe(false);
    expect(await NotificationsDataGet(undefined, "missing")).toBeNull();
  });

  test("deletes only notifications matching the source and read filters", async () => {
    const insert = mockDatabase.prepare(
      'INSERT INTO notifications (id, title, body, source, severity, data, createdAt, "read") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run("build-unread", "Build unread", "", "build", "info", "{}", "2026-01-01T00:00:00.000Z", 0);
    insert.run("build-read", "Build read", "", "build", "info", "{}", "2026-01-02T00:00:00.000Z", 1);
    insert.run("deploy-unread", "Deploy unread", "", "deploy", "info", "{}", "2026-01-03T00:00:00.000Z", 0);
    insert.run("deploy-read", "Deploy read", "", "deploy", "info", "{}", "2026-01-04T00:00:00.000Z", 1);

    expect(await NotificationsDataDeleteAll(undefined, "build", "unread")).toBe(1);
    expect(await NotificationsDataCount(undefined)).toBe(3);
    expect(await NotificationsDataCount(undefined, "build")).toBe(1);
    expect(await NotificationsDataCount(undefined, "deploy", "unread")).toBe(1);
    expect(await NotificationsDataCount(undefined, "deploy", "read")).toBe(1);
  });

  test("deletes every notification when no filters are given", async () => {
    const insert = mockDatabase.prepare(
      'INSERT INTO notifications (id, title, body, source, severity, data, createdAt, "read") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run("build-unread", "Build unread", "", "build", "info", "{}", "2026-01-01T00:00:00.000Z", 0);
    insert.run("deploy-read", "Deploy read", "", "deploy", "info", "{}", "2026-01-02T00:00:00.000Z", 1);

    expect(await NotificationsDataDeleteAll(undefined)).toBe(2);
    expect(await NotificationsDataCount(undefined)).toBe(0);
  });

  test("searches title and body case-insensitively and counts the same set", async () => {
    const insert = mockDatabase.prepare(
      'INSERT INTO notifications (id, title, body, source, severity, data, createdAt, "read") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run("title-match", "Deploy Failed", "", "build", "info", "{}", "2026-01-01T00:00:00.000Z", 0);
    insert.run("body-match", "Nightly run", "pipeline DEPLOYED to staging", "build", "info", "{}", "2026-01-02T00:00:00.000Z", 0);
    insert.run("no-match", "Backup done", "nothing to see", "backup", "info", "{}", "2026-01-03T00:00:00.000Z", 0);

    expect(
      (await NotificationsDataList(undefined, 50, 0, "", "all", "", "deploy failed")).map((row) => row.id),
    ).toEqual(["title-match"]);
    expect(
      (await NotificationsDataList(undefined, 50, 0, "", "all", "", "DEPLOYED")).map((row) => row.id),
    ).toEqual(["body-match"]);
    expect(await NotificationsDataList(undefined, 50, 0, "", "all", "", "deploy")).toHaveLength(2);
    expect(await NotificationsDataCount(undefined, "", "all", "", "deploy")).toBe(2);
    expect(await NotificationsDataList(undefined, 50, 0, "", "all", "", "missing-term")).toEqual([]);
    expect(await NotificationsDataCount(undefined, "", "all", "", "missing-term")).toBe(0);
  });

  test("matches LIKE wildcards literally in search terms", async () => {
    const insert = mockDatabase.prepare(
      'INSERT INTO notifications (id, title, body, source, severity, data, createdAt, "read") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run("wildcard", "Progress 100%", "disk 50_percent full", "build", "info", "{}", "2026-01-01T00:00:00.000Z", 0);
    insert.run("plain", "Just a task", "", "build", "info", "{}", "2026-01-02T00:00:00.000Z", 0);

    expect(
      (await NotificationsDataList(undefined, 50, 0, "", "all", "", "100%")).map((row) => row.id),
    ).toEqual(["wildcard"]);
    expect(
      (await NotificationsDataList(undefined, 50, 0, "", "all", "", "50_percent")).map((row) => row.id),
    ).toEqual(["wildcard"]);
    expect(await NotificationsDataList(undefined, 50, 0, "", "all", "", "100_")).toEqual([]);
  });

  test("filters by severity case-insensitively and combines with source and read", async () => {
    const insert = mockDatabase.prepare(
      'INSERT INTO notifications (id, title, body, source, severity, data, createdAt, "read") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run("error-old", "Error old", "", "build", "error", "{}", "2026-01-01T00:00:00.000Z", 0);
    insert.run("info", "Just info", "", "build", "info", "{}", "2026-01-02T00:00:00.000Z", 0);
    insert.run("error-read", "Error read", "", "deploy", "ERROR", "{}", "2026-01-03T00:00:00.000Z", 1);

    expect(
      (await NotificationsDataList(undefined, 50, 0, "", "all", "error")).map((row) => row.id),
    ).toEqual(["error-read", "error-old"]);
    expect(
      (await NotificationsDataList(undefined, 50, 0, "", "all", "ERROR")).map((row) => row.id),
    ).toEqual(["error-read", "error-old"]);
    expect(
      (await NotificationsDataList(undefined, 50, 0, "build", "unread", "error")).map((row) => row.id),
    ).toEqual(["error-old"]);
    expect(await NotificationsDataCount(undefined, "", "all", "error")).toBe(2);
  });

  test("returns sources with per-source unread counts", async () => {
    expect(await NotificationsDataSources(undefined)).toEqual([]);
    const insert = mockDatabase.prepare(
      'INSERT INTO notifications (id, title, body, source, severity, data, createdAt, "read") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run("build-unread", "Build unread", "", "build", "info", "{}", "2026-01-01T00:00:00.000Z", 0);
    insert.run("build-read", "Build read", "", "build", "info", "{}", "2026-01-02T00:00:00.000Z", 1);
    insert.run("deploy-unread", "Deploy unread", "", "deploy", "info", "{}", "2026-01-03T00:00:00.000Z", 0);

    expect(await NotificationsDataSources(undefined)).toEqual([
      { source: "build", unread: 1 },
      { source: "deploy", unread: 1 },
    ]);
  });

  test("scopes bulk read and delete to severity and search filters", async () => {
    const insert = mockDatabase.prepare(
      'INSERT INTO notifications (id, title, body, source, severity, data, createdAt, "read") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insert.run("err-1", "Disk full", "", "build", "error", "{}", "2026-01-01T00:00:00.000Z", 0);
    insert.run("err-2", "Crash loop", "failed to deploy", "build", "error", "{}", "2026-01-02T00:00:00.000Z", 0);
    insert.run("ok-1", "All good", "", "build", "info", "{}", "2026-01-03T00:00:00.000Z", 0);

    expect(await NotificationsDataUpdateReadAll(undefined, "", "all", "error", "")).toBe(2);
    expect(await NotificationsDataCount(undefined, "", "unread", "error")).toBe(0);
    expect(await NotificationsDataCount(undefined, "", "unread", "")).toBe(1);

    expect(await NotificationsDataDeleteAll(undefined, "", "all", "", "deploy")).toBe(1);
    expect(await NotificationsDataCount(undefined)).toBe(2);
  });
});
