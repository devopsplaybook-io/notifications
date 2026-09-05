-- Store the read/unread state of notifications (unread by default)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS "read" BOOLEAN NOT NULL DEFAULT FALSE;
