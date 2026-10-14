-- email_rules: rules that email new notifications matching an optional source
-- (empty = any service) and an optional severity (empty = any severity) to a
-- recipient address
CREATE TABLE IF NOT EXISTS email_rules (
    id VARCHAR(50) NOT NULL PRIMARY KEY,
    source VARCHAR(200) NOT NULL DEFAULT '',
    severity VARCHAR(20) NOT NULL DEFAULT '',
    recipient VARCHAR(320) NOT NULL,
    createdAt VARCHAR(100) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_rules_source_severity
  ON email_rules(source, severity);
