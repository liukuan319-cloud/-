CREATE TABLE class_records (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  kind TEXT NOT NULL CHECK(kind IN ('assignment','fee','activity','shift')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  event_at TEXT,
  due_at TEXT,
  amount_cents INTEGER,
  fee_direction TEXT CHECK(fee_direction IN ('income','expense')),
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_class_records_lookup ON class_records(class_id,kind,created_at DESC);

CREATE TABLE notice_memories (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  content TEXT NOT NULL,
  source_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notice_memories_owner ON notice_memories(class_id,member_id,created_at DESC);
