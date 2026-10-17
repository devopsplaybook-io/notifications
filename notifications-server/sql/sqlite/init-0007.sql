-- push_subscriptions: per-device management (id, userAgent, createdAt).
-- Defaults keep pre-0.21.0 inserts (userId, endpoint, subscription) working
-- after a rollback to 0.20.0.
CREATE TABLE push_subscriptions_new (
    id VARCHAR(50) NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    userId VARCHAR(50) NOT NULL,
    endpoint VARCHAR(2000) NOT NULL UNIQUE,
    subscription TEXT NOT NULL,
    userAgent VARCHAR(500) NOT NULL DEFAULT '',
    createdAt VARCHAR(100) NOT NULL DEFAULT ''
);

INSERT INTO push_subscriptions_new (userId, endpoint, subscription)
  SELECT userId, endpoint, subscription FROM push_subscriptions;

DROP TABLE push_subscriptions;

ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_userId
  ON push_subscriptions("userId");
