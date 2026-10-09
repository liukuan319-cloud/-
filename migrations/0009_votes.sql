CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  author_id TEXT NOT NULL REFERENCES members(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  anonymous INTEGER NOT NULL DEFAULT 1,
  salt TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_votes_class ON votes(class_id, created_at);
CREATE TABLE vote_options (
  id TEXT PRIMARY KEY,
  vote_id TEXT NOT NULL REFERENCES votes(id),
  label TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE vote_records (
  vote_id TEXT NOT NULL REFERENCES votes(id),
  voter_hash TEXT NOT NULL,
  member_id TEXT REFERENCES members(id),
  option_id TEXT NOT NULL REFERENCES vote_options(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(vote_id, voter_hash)
);
