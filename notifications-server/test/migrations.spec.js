const Database = require("better-sqlite3");
const fs = require("fs");
const os = require("os");
const path = require("path");

const sqliteMigrations = path.resolve(__dirname, "../sql/sqlite");
const postgresMigrations = path.resolve(__dirname, "../sql/postgres");

function migrationFiles(directory) {
  return fs
    .readdirSync(directory)
    .filter((file) => /^init-\d+\.sql$/.test(file))
    .sort();
}

describe("database migrations", () => {
  test("applies retention indexes to an existing SQLite database and keeps its data", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notifications-db-"));
    const databasePath = path.join(directory, "database.db");
    const database = new Database(databasePath);
    try {
      for (const file of migrationFiles(sqliteMigrations)) {
        if (file === "init-0004.sql") break;
        database.exec(fs.readFileSync(path.join(sqliteMigrations, file), "utf8"));
      }
      database
        .prepare(
          "INSERT INTO api_tokens (id, name, token, createdAt) VALUES (?, ?, ?, ?)",
        )
        .run("legacy-token", "Existing client", "client-secret", new Date().toISOString());
      database
        .prepare(
          "INSERT INTO notifications (id, title, body, source, severity, data, createdAt, `read`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("notification-1", "Existing", "", "test-source", "info", "{}", new Date().toISOString(), 0);
      database.exec(
        fs.readFileSync(path.join(sqliteMigrations, "init-0004.sql"), "utf8"),
      );

      const indexes = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => row.name);
      expect(indexes).toContain("idx_notifications_source_createdAt");
      expect(indexes).toContain("idx_notifications_read_createdAt");
      expect(
        database
          .prepare("SELECT token FROM api_tokens WHERE id = ?")
          .get("legacy-token").token,
      ).toBe("legacy:client-secret");
      expect(
        database
          .prepare("SELECT title FROM notifications WHERE id = ?")
          .get("notification-1").title,
      ).toBe("Existing");

      const backupPath = path.join(directory, "database.db.backup");
      await database.backup(backupPath);
      const backup = new Database(backupPath);
      expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(
        backup
          .prepare("SELECT title FROM notifications WHERE id = ?")
          .get("notification-1").title,
      ).toBe("Existing");
      backup.close();
    } finally {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("applies the Postgres migration sequence in an in-memory Postgres emulator", () => {
    const { newDb } = require("pg-mem");
    const database = newDb();
    for (const file of migrationFiles(postgresMigrations)) {
      if (file === "init-0004.sql") break;
      database.public.none(
        fs.readFileSync(path.join(postgresMigrations, file), "utf8"),
      );
    }
    database.public.none(`
      INSERT INTO api_tokens (id, name, token, "createdAt")
      VALUES ('00000000-0000-0000-0000-000000000001', 'Existing', 'legacy-token', '2026-01-01T00:00:00.000Z')
    `);
    database.public.none(
      fs.readFileSync(
        path.join(postgresMigrations, "init-0004.sql"),
        "utf8",
      ),
    );
    const indexes = [...database.public.getTable("notifications").indexByHashAndName.keys()];
    expect(indexes).toContain("createdAt|source");
    expect(indexes).toContain("createdAt|read");
    expect(
      database.public
        .one(
          "SELECT token FROM api_tokens WHERE id = '00000000-0000-0000-0000-000000000001'",
        )
        .token,
    ).toBe("legacy:legacy-token");

    database.public.none(`
      INSERT INTO notifications (id, title, body, source, severity, data, "createdAt", "read")
      VALUES ('00000000-0000-0000-0000-000000000002', 'Test', '', 'source', 'info', '{}', '2026-01-01T00:00:00.000Z', FALSE)
    `);
    expect(
      database.public
        .many(
          'SELECT * FROM notifications WHERE source = \'source\' AND NOT "read" ORDER BY "createdAt" DESC LIMIT 10 OFFSET 0',
        ),
    ).toHaveLength(1);
    database.public.none(
      `DELETE FROM notifications WHERE "createdAt" < '2026-06-28T00:00:00.000Z'`,
    );
    expect(database.public.many("SELECT * FROM notifications")).toHaveLength(0);
  });
});
