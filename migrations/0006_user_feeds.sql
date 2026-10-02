CREATE TABLE IF NOT EXISTS user_feeds (
  user_id TEXT PRIMARY KEY,
  library_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
