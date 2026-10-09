CREATE TABLE reminders (
  class_id TEXT NOT NULL REFERENCES classes(id),
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  days_before INTEGER NOT NULL,
  PRIMARY KEY(class_id,type)
);
CREATE TABLE reminders_log (
  class_id TEXT NOT NULL REFERENCES classes(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  reminder_key TEXT NOT NULL,
  message TEXT NOT NULL,
  due_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(member_id,reminder_key)
);
