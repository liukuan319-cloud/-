CREATE TABLE timetable_entries (
 id TEXT PRIMARY KEY,
 class_id TEXT NOT NULL REFERENCES classes(id),
 weekday TEXT NOT NULL CHECK(weekday IN ('周一','周二','周三','周四','周五','周六','周日')),
 period TEXT NOT NULL,
 course TEXT NOT NULL,
 room TEXT NOT NULL DEFAULT '',
 position INTEGER NOT NULL
);
CREATE TABLE duty_entries (
 id TEXT PRIMARY KEY,
 class_id TEXT NOT NULL REFERENCES classes(id),
 weekday TEXT NOT NULL CHECK(weekday IN ('周一','周二','周三','周四','周五','周六','周日')),
 member_id TEXT NOT NULL REFERENCES members(id),
 position INTEGER NOT NULL,
 UNIQUE(class_id,weekday,member_id)
);
CREATE INDEX idx_timetable_class_weekday ON timetable_entries(class_id,weekday,position);
CREATE INDEX idx_duty_class_weekday ON duty_entries(class_id,weekday,position);
