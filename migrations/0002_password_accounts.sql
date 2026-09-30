CREATE TABLE users_v2 (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT,
  name TEXT,
  picture TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO users_v2 (id, google_sub, email, name, picture, password_hash, created_at)
SELECT id, google_sub, email, name, picture, NULL, created_at FROM users;

DROP TABLE users;

ALTER TABLE users_v2 RENAME TO users;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL AND email != '';
