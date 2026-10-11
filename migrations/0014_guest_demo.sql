CREATE TABLE guest_sessions (
 token_hash TEXT PRIMARY KEY,
 class_id TEXT NOT NULL REFERENCES classes(id),
 expires_at TEXT NOT NULL
);
CREATE INDEX idx_guest_sessions_expiry ON guest_sessions(expires_at);
CREATE TABLE guest_messages (
 id TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL REFERENCES guest_sessions(token_hash),
 role TEXT NOT NULL,
 content TEXT NOT NULL,
 cards TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL
);

