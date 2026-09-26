UPDATE api_tokens
SET token = 'legacy:' || token
WHERE token NOT LIKE 'sha256:%' AND token NOT LIKE 'legacy:%';

CREATE INDEX IF NOT EXISTS idx_notifications_source_createdAt
  ON notifications(source, "createdAt");

CREATE INDEX IF NOT EXISTS idx_notifications_read_createdAt
  ON notifications("read", "createdAt");
