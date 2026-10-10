ALTER TABLE members ADD COLUMN username TEXT;
ALTER TABLE members ADD COLUMN password_hash TEXT;
ALTER TABLE members ADD COLUMN password_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN access_role TEXT NOT NULL DEFAULT 'student' CHECK(access_role IN ('faculty','cadre','student'));
ALTER TABLE members ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN locked_until TEXT;
UPDATE members SET access_role='cadre' WHERE role='admin';
CREATE UNIQUE INDEX idx_members_username ON members(username) WHERE username IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_members_active_student_no ON members(student_no) WHERE student_no IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_members_faculty ON members(class_id) WHERE access_role='faculty' AND deleted_at IS NULL;
CREATE TABLE personal_tasks (
 id TEXT PRIMARY KEY,
 class_id TEXT NOT NULL REFERENCES classes(id),
 member_id TEXT NOT NULL REFERENCES members(id),
 title TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 due_at TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX idx_personal_tasks_member ON personal_tasks(class_id,member_id,status,due_at);
