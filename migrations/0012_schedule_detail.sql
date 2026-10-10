ALTER TABLE timetable_entries ADD COLUMN week_start TEXT;
ALTER TABLE timetable_entries ADD COLUMN period_number INTEGER;
ALTER TABLE timetable_entries ADD COLUMN teacher TEXT NOT NULL DEFAULT '';
ALTER TABLE timetable_entries ADD COLUMN not_this_week INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_timetable_week ON timetable_entries(class_id,week_start,weekday,period_number);
