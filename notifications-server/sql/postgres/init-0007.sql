-- push_subscriptions: per-device management (id, userAgent, createdAt).
-- Defaults keep pre-0.21.0 inserts (userId, endpoint, subscription) working
-- after a rollback to 0.20.0. gen_random_uuid() requires PostgreSQL 13+.
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS "id" UUID DEFAULT gen_random_uuid();

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS "userAgent" VARCHAR(500) NOT NULL DEFAULT '';

ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS "createdAt" VARCHAR(100) NOT NULL DEFAULT '';

UPDATE push_subscriptions SET "id" = gen_random_uuid() WHERE "id" IS NULL;

ALTER TABLE push_subscriptions ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY ("id");

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_userId
  ON push_subscriptions("userId");
