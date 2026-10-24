-- email_deliveries: add the primary key SQLite already declares
-- (init-0008.sql: id ... PRIMARY KEY). Older Postgres databases created this
-- table without the constraint, so duplicate ids are collapsed defensively
-- (one row per id, smallest values) before the key is added; rows with unique
-- ids are preserved unchanged.
DROP TABLE IF EXISTS email_deliveries_dedupe;

CREATE TABLE email_deliveries_dedupe (
    "id" UUID NOT NULL,
    "recipient" VARCHAR(320) NOT NULL,
    "notificationId" VARCHAR(50) NOT NULL DEFAULT '',
    "notificationTitle" VARCHAR(500) NOT NULL DEFAULT '',
    "source" VARCHAR(200) NOT NULL DEFAULT '',
    "severity" VARCHAR(20) NOT NULL DEFAULT '',
    "status" VARCHAR(20) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error" VARCHAR(500) NOT NULL DEFAULT '',
    "createdAt" VARCHAR(100) NOT NULL
);

INSERT INTO email_deliveries_dedupe ("id", "recipient", "notificationId", "notificationTitle", "source", "severity", "status", "attempts", "error", "createdAt")
SELECT "id",
       MIN("recipient"),
       MIN("notificationId"),
       MIN("notificationTitle"),
       MIN("source"),
       MIN("severity"),
       MIN("status"),
       MIN("attempts"),
       MIN("error"),
       MIN("createdAt")
FROM email_deliveries
GROUP BY "id";

DELETE FROM email_deliveries;

INSERT INTO email_deliveries ("id", "recipient", "notificationId", "notificationTitle", "source", "severity", "status", "attempts", "error", "createdAt")
SELECT "id", "recipient", "notificationId", "notificationTitle", "source", "severity", "status", "attempts", "error", "createdAt"
FROM email_deliveries_dedupe;

DROP TABLE email_deliveries_dedupe;

ALTER TABLE email_deliveries ADD CONSTRAINT email_deliveries_pkey PRIMARY KEY ("id");
