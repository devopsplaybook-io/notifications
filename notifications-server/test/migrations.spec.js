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

  test("applies 0005 integrity constraints and tokenVersion to an existing SQLite database", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notifications-db-"));
    const database = new Database(path.join(directory, "database.db"));
    const now = new Date().toISOString();
    try {
      for (const file of migrationFiles(sqliteMigrations)) {
        if (file === "init-0005.sql") break;
        database.exec(fs.readFileSync(path.join(sqliteMigrations, file), "utf8"));
      }
      database
        .prepare("INSERT INTO users (id, name, passwordEncrypted) VALUES (?, ?, ?)")
        .run("user-1", "admin", "hash");
      database
        .prepare(
          "INSERT INTO notifications (id, title, body, source, severity, data, createdAt, `read`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("notification-1", "Existing", "", "test-source", "info", "{}", now, 0);
      database
        .prepare("INSERT INTO api_tokens (id, name, token, createdAt) VALUES (?, ?, ?, ?)")
        .run("token-1", "Client", "sha256:abc", now);
      const insertSubscription = database.prepare(
        "INSERT INTO push_subscriptions (userId, endpoint, subscription) VALUES (?, ?, ?)",
      );
      insertSubscription.run("user-1", "https://push.example/one", '{"v":1}');
      insertSubscription.run("user-1", "https://push.example/one", '{"v":2}');
      insertSubscription.run("user-2", "https://push.example/two", "{}");
      database
        .prepare("INSERT INTO metadata (type, value, dateCreated) VALUES (?, ?, ?)")
        .run("auth_token", "legacy-secret", now);
      database
        .prepare("INSERT INTO metadata (type, value, dateCreated) VALUES (?, ?, ?)")
        .run("db_version", "4", now);

      database.exec(
        fs.readFileSync(path.join(sqliteMigrations, "init-0005.sql"), "utf8"),
      );

      const subscriptions = database
        .prepare("SELECT * FROM push_subscriptions ORDER BY endpoint")
        .all();
      expect(subscriptions).toHaveLength(2);
      expect(subscriptions[0].subscription).toBe('{"v":1}');
      expect(() =>
        insertSubscription.run("user-1", "https://push.example/one", "{}"),
      ).toThrow();

      const user = database.prepare("SELECT * FROM users WHERE id = ?").get("user-1");
      expect(user.tokenVersion).toBe(0);
      expect(() =>
        database
          .prepare("INSERT INTO users (id, name, passwordEncrypted) VALUES (?, ?, ?)")
          .run("user-2", "admin", "hash"),
      ).toThrow();
      expect(() =>
        database
          .prepare(
            "INSERT INTO notifications (id, title, body, source, severity, data, createdAt, `read`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run("notification-1", "Duplicate", "", "s", "info", "{}", now, 0),
      ).toThrow();
      expect(() =>
        database
          .prepare("INSERT INTO api_tokens (id, name, token, createdAt) VALUES (?, ?, ?, ?)")
          .run("token-1", "Duplicate", "sha256:def", now),
      ).toThrow();

      const metadata = database.prepare("SELECT * FROM metadata").all();
      expect(metadata.map((row) => row.type).sort()).toEqual(["db_version"]);
      expect(
        database
          .prepare("SELECT typeof(value) AS t FROM metadata WHERE type = ?")
          .get("db_version").t,
      ).toBe("text");
      expect(
        database.prepare("SELECT title FROM notifications WHERE id = ?").get("notification-1")
          .title,
      ).toBe("Existing");

      database.exec("PRAGMA integrity_check");
    } finally {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("applies 0005 integrity constraints and tokenVersion in the Postgres emulator", () => {
    const { newDb } = require("pg-mem");
    const database = newDb();
    for (const file of migrationFiles(postgresMigrations)) {
      if (file === "init-0005.sql") break;
      database.public.none(
        fs.readFileSync(path.join(postgresMigrations, file), "utf8"),
      );
    }
    database.public.none(`
      INSERT INTO users ("id", "name", "passwordEncrypted")
      VALUES ('00000000-0000-0000-0000-000000000001', 'admin', 'hash');
      INSERT INTO notifications ("id", "title", "body", "source", "severity", "data", "createdAt", "read")
      VALUES ('00000000-0000-0000-0000-000000000002', 'Existing', '', 'source', 'info', '{}', '2026-01-01T00:00:00.000Z', FALSE);
      INSERT INTO api_tokens ("id", "name", "token", "createdAt")
      VALUES ('00000000-0000-0000-0000-000000000003', 'Client', 'legacy:secret', '2026-01-01T00:00:00.000Z');
      INSERT INTO push_subscriptions ("userId", "endpoint", "subscription")
      VALUES ('00000000-0000-0000-0000-000000000001', 'https://push.example/one', '{"v":1}');
      INSERT INTO push_subscriptions ("userId", "endpoint", "subscription")
      VALUES ('00000000-0000-0000-0000-000000000004', 'https://push.example/one', '{"v":2}');
      INSERT INTO push_subscriptions ("userId", "endpoint", "subscription")
      VALUES ('00000000-0000-0000-0000-000000000001', 'https://push.example/two', '{}');
      INSERT INTO metadata ("type", "value", "dateCreated") VALUES ('auth_token', 'legacy-secret', '2026-01-01T00:00:00.000Z');
      INSERT INTO metadata ("type", "value", "dateCreated") VALUES ('db_version', '4', '2026-01-01T00:00:00.000Z');
    `);
    database.public.none(
      fs.readFileSync(path.join(postgresMigrations, "init-0005.sql"), "utf8"),
    );

    expect(
      database.public.one("SELECT COUNT(*) AS count FROM push_subscriptions").count,
    ).toBe(2);
    expect(() =>
      database.public.none(
        `INSERT INTO push_subscriptions ("userId", "endpoint", "subscription") VALUES ('00000000-0000-0000-0000-000000000001', 'https://push.example/one', '{}')`,
      ),
    ).toThrow();
    expect(
      database.public.one(
        `SELECT "tokenVersion" FROM users WHERE "id" = '00000000-0000-0000-0000-000000000001'`,
      ).tokenVersion,
    ).toBe(0);
    expect(() =>
      database.public.none(
        `INSERT INTO users ("id", "name", "passwordEncrypted") VALUES ('00000000-0000-0000-0000-000000000005', 'admin', 'hash')`,
      ),
    ).toThrow();
    expect(() =>
      database.public.none(
        `INSERT INTO notifications ("id", "title", "body", "source", "severity", "data", "createdAt", "read") VALUES ('00000000-0000-0000-0000-000000000002', 'Duplicate', '', 'source', 'info', '{}', '2026-01-01T00:00:00.000Z', FALSE)`,
      ),
    ).toThrow();
    expect(() =>
      database.public.none(
        `INSERT INTO api_tokens ("id", "name", "token", "createdAt") VALUES ('00000000-0000-0000-0000-000000000003', 'Duplicate', 'sha256:def', '2026-01-01T00:00:00.000Z')`,
      ),
    ).toThrow();
    expect(
      database.public.many("SELECT * FROM metadata"),
    ).toHaveLength(1);
    expect(
      database.public.one("SELECT COUNT(*) AS count FROM notifications").count,
    ).toBe(1);
  });

  test("applies 0007 push device columns to an existing SQLite database and backfills ids", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "notifications-db-"));
    const database = new Database(path.join(directory, "database.db"));
    try {
      for (const file of migrationFiles(sqliteMigrations)) {
        if (file === "init-0007.sql") break;
        database.exec(fs.readFileSync(path.join(sqliteMigrations, file), "utf8"));
      }
      const insertSubscription = database.prepare(
        "INSERT INTO push_subscriptions (userId, endpoint, subscription) VALUES (?, ?, ?)",
      );
      insertSubscription.run("user-1", "https://push.example/one", '{"v":1}');
      insertSubscription.run("user-1", "https://push.example/two", "{}");
      insertSubscription.run("user-2", "https://push.example/three", "{}");

      database.exec(
        fs.readFileSync(path.join(sqliteMigrations, "init-0007.sql"), "utf8"),
      );

      const subscriptions = database
        .prepare("SELECT * FROM push_subscriptions ORDER BY endpoint")
        .all();
      expect(subscriptions).toHaveLength(3);
      expect(subscriptions[0].endpoint).toBe("https://push.example/one");
      expect(subscriptions[0].subscription).toBe('{"v":1}');
      expect(subscriptions[0].userAgent).toBe("");
      expect(subscriptions[0].createdAt).toBe("");
      const ids = new Set(subscriptions.map((row) => row.id));
      expect(ids.size).toBe(3);
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{32}$/);
      }
      // New rows must keep working without providing the new columns.
      insertSubscription.run("user-3", "https://push.example/four", "{}");
      const added = database
        .prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
        .get("https://push.example/four");
      expect(added.id).toMatch(/^[0-9a-f]{32}$/);
      expect(added.userAgent).toBe("");
      // Ids are unique: a duplicate insert must fail.
      const duplicate = database.prepare(
        "INSERT INTO push_subscriptions (id, \"userId\", endpoint, subscription) VALUES (?, ?, ?, ?)",
      );
      expect(() =>
        duplicate.run(subscriptions[0].id, "user-9", "https://push.example/five", "{}"),
      ).toThrow();

      expect(
        database.pragma("integrity_check", { simple: true }),
      ).toBe("ok");
    } finally {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("applies 0007 push device columns in the Postgres emulator", () => {
    const { newDb } = require("pg-mem");
    const crypto = require("crypto");
    const database = newDb();
    database.public.registerFunction({
      name: "gen_random_uuid",
      args: [],
      returns: "uuid",
      implementation: () => crypto.randomUUID(),
      impure: true,
    });
    for (const file of migrationFiles(postgresMigrations)) {
      if (file === "init-0007.sql") break;
      database.public.none(
        fs.readFileSync(path.join(postgresMigrations, file), "utf8"),
      );
    }
    database.public.none(`
      INSERT INTO push_subscriptions ("userId", "endpoint", "subscription")
      VALUES ('00000000-0000-0000-0000-000000000001', 'https://push.example/one', '{"v":1}');
      INSERT INTO push_subscriptions ("userId", "endpoint", "subscription")
      VALUES ('00000000-0000-0000-0000-000000000002', 'https://push.example/two', '{}');
    `);

    database.public.none(
      fs.readFileSync(path.join(postgresMigrations, "init-0007.sql"), "utf8"),
    );

    const subscriptions = database.public.many(
      'SELECT * FROM push_subscriptions ORDER BY "endpoint"',
    );
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions[0].endpoint).toBe("https://push.example/one");
    expect(subscriptions[0].subscription).toBe('{"v":1}');
    expect(subscriptions[0].userAgent).toBe("");
    expect(subscriptions[0].createdAt).toBe("");
    const ids = new Set(subscriptions.map((row) => row.id));
    expect(ids.size).toBe(2);
    // New rows get generated ids from the column default.
    database.public.none(
      `INSERT INTO push_subscriptions ("userId", "endpoint", "subscription")
       VALUES ('00000000-0000-0000-0000-000000000003', 'https://push.example/three', '{}')`,
    );
    const added = database.public.one(
      `SELECT * FROM push_subscriptions WHERE "endpoint" = 'https://push.example/three'`,
    );
    expect(added.id).not.toBeNull();
    expect(() =>
      database.public.none(
        `INSERT INTO push_subscriptions ("id", "userId", "endpoint", "subscription")
         VALUES ('${subscriptions[0].id}', '00000000-0000-0000-0000-000000000009', 'https://push.example/four', '{}')`,
      ),
    ).toThrow();
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
