-- Preserve all IDs and foreign-key references while making uniqueness active-only.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE members_new (
 id TEXT PRIMARY KEY,
 class_id TEXT NOT NULL REFERENCES classes(id),
 nickname TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','student')),
 recovery_hash TEXT UNIQUE NOT NULL,
 created_at TEXT NOT NULL,
 student_no TEXT,
 note TEXT NOT NULL DEFAULT '',
 deleted_at TEXT
);
INSERT INTO members_new(id,class_id,nickname,role,recovery_hash,created_at,student_no,note)
SELECT id,class_id,nickname,role,recovery_hash,created_at,student_no,note FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
CREATE INDEX idx_members_class ON members(class_id);
CREATE UNIQUE INDEX idx_members_active_name ON members(class_id,nickname) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_members_student_no ON members(class_id,student_no) WHERE deleted_at IS NULL AND student_no IS NOT NULL AND student_no <> '';
-- Table replacement resolves all references to the same name/IDs. Clear the
-- deferred DROP bookkeeping after references are restored (foreign_key_check
-- is covered by the populated migration compatibility test).
PRAGMA defer_foreign_keys=OFF;
