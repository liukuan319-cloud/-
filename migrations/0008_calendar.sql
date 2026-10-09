ALTER TABLE classes ADD COLUMN semester_start TEXT;

CREATE TABLE exams (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  registration_deadline TEXT,
  exam_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_exams_class_date ON exams(class_id, exam_at);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  event_date TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_calendar_events_class_date ON calendar_events(class_id, event_date);
