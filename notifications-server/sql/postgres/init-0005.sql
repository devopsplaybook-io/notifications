-- users: per-user token version (session revocation) + integrity constraints
ALTER TABLE users ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY ("id");

ALTER TABLE users ADD CONSTRAINT users_name_unique UNIQUE ("name");

-- notifications: primary key on id
ALTER TABLE notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY ("id");

-- api_tokens: primary key on id
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_pkey PRIMARY KEY ("id");

-- push_subscriptions: one row per endpoint (defensive dedupe keeps the smallest row)
CREATE TABLE push_subscriptions_new (
    "userId" UUID NOT NULL,
    "endpoint" VARCHAR(2000) NOT NULL,
    "subscription" TEXT NOT NULL,
    CONSTRAINT push_subscriptions_endpoint_unique UNIQUE ("endpoint")
);

INSERT INTO push_subscriptions_new ("userId", "endpoint", "subscription")
SELECT MIN("userId"::text)::uuid, "endpoint", MIN("subscription")
FROM push_subscriptions
GROUP BY "endpoint";

DROP TABLE push_subscriptions;

ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

-- metadata: drop the legacy JWT key copy (now environment-only)
DELETE FROM metadata WHERE "type" = 'auth_token';
