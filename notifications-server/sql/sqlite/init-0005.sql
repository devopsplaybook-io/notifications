-- users: integrity constraints + per-user token version (session revocation)
CREATE TABLE users_new (
    id VARCHAR(50) NOT NULL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    passwordEncrypted VARCHAR(500) NOT NULL,
    tokenVersion INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users_new (id, name, passwordEncrypted, tokenVersion)
  SELECT id, name, passwordEncrypted, 0 FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- notifications: primary key on id
CREATE TABLE notifications_new (
    id VARCHAR(50) NOT NULL PRIMARY KEY,
    title VARCHAR(1000) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    source VARCHAR(200) NOT NULL DEFAULT 'api',
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    data TEXT NOT NULL DEFAULT '{}',
    createdAt VARCHAR(100) NOT NULL,
    "read" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO notifications_new (id, title, body, source, severity, data, createdAt, "read")
  SELECT id, title, body, source, severity, data, createdAt, "read" FROM notifications;

DROP TABLE notifications;

ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_createdAt ON notifications(createdAt);

CREATE INDEX IF NOT EXISTS idx_notifications_source_createdAt ON notifications(source, createdAt);

CREATE INDEX IF NOT EXISTS idx_notifications_read_createdAt ON notifications("read", createdAt);

-- api_tokens: primary key on id
CREATE TABLE api_tokens_new (
    id VARCHAR(50) NOT NULL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    token VARCHAR(200) NOT NULL,
    createdAt VARCHAR(100) NOT NULL
);

INSERT INTO api_tokens_new (id, name, token, createdAt)
  SELECT id, name, token, createdAt FROM api_tokens;

DROP TABLE api_tokens;

ALTER TABLE api_tokens_new RENAME TO api_tokens;

CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens(token);

-- push_subscriptions: one row per endpoint (defensive dedupe keeps the earliest row)
CREATE TABLE push_subscriptions_new (
    userId VARCHAR(50) NOT NULL,
    endpoint VARCHAR(2000) NOT NULL UNIQUE,
    subscription TEXT NOT NULL
);

INSERT INTO push_subscriptions_new (userId, endpoint, subscription)
  SELECT userId, endpoint, subscription FROM push_subscriptions
  WHERE rowid IN (SELECT MIN(rowid) FROM push_subscriptions GROUP BY endpoint);

DROP TABLE push_subscriptions;

ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

-- metadata: text value affinity matching Postgres + drop the legacy JWT key copy
CREATE TABLE metadata_new (
    type VARCHAR(100) NOT NULL,
    value VARCHAR(100) NOT NULL,
    dateCreated VARCHAR(100) NOT NULL
);

INSERT INTO metadata_new (type, value, dateCreated)
  SELECT type, CAST(value AS TEXT), dateCreated FROM metadata;

DROP TABLE metadata;

ALTER TABLE metadata_new RENAME TO metadata;

DELETE FROM metadata WHERE type = 'auth_token';
