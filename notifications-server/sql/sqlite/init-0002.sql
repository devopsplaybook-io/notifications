CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(50) NOT NULL,
    title VARCHAR(1000) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    source VARCHAR(200) NOT NULL DEFAULT 'api',
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    data TEXT NOT NULL DEFAULT '{}',
    createdAt VARCHAR(100) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_createdAt ON notifications(createdAt);

CREATE TABLE IF NOT EXISTS api_tokens (
    id VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    token VARCHAR(200) NOT NULL,
    createdAt VARCHAR(100) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens(token);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    userId VARCHAR(50) NOT NULL,
    endpoint VARCHAR(2000) NOT NULL,
    subscription TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
