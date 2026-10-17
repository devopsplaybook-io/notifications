-- email_deliveries: recent per-recipient email delivery outcomes so delivery
-- problems are visible in the UI instead of only in telemetry
CREATE TABLE IF NOT EXISTS email_deliveries (
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

CREATE INDEX IF NOT EXISTS idx_email_deliveries_createdAt
  ON email_deliveries("createdAt");

-- email_rules.severityMode: 'exact' (default) matches the rule severity
-- exactly as before; 'threshold' matches the rule severity and everything
-- above it in the escalation order
ALTER TABLE email_rules ADD COLUMN IF NOT EXISTS "severityMode" VARCHAR(20) NOT NULL DEFAULT 'exact';
