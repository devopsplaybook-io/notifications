const Database = require("better-sqlite3");
const mockDatabase = new Database(":memory:");
const mockCounterAdd = jest.fn();
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
  OTelMeter: () => ({
    createCounter: () => ({ add: mockCounterAdd }),
  }),
}));

const {
  DbUtilsQuerySQL,
} = require("@devopsplaybook.io/common-utils");
const {
  NotificationsDataAdd,
  NotificationsDataCount,
  NotificationsDataDelete,
  NotificationsDataList,
  NotificationsDataPrune,
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
    expect(mockCounterAdd).toHaveBeenCalledWith(1);
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
});
