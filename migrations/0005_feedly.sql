CREATE TABLE IF NOT EXISTS feedly_tokens (
  user_id TEXT PRIMARY KEY,
  feedly_id TEXT,
  refresh_token TEXT,
  access_token TEXT,
  access_expires_at TEXT
);
