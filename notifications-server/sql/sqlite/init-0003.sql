-- Store the read/unread state of notifications (unread by default)
ALTER TABLE notifications ADD COLUMN read INTEGER NOT NULL DEFAULT 0;
