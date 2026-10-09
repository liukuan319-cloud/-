ALTER TABLE members ADD COLUMN student_no TEXT;
ALTER TABLE members ADD COLUMN note TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_members_student_no ON members(class_id,student_no) WHERE student_no IS NOT NULL AND student_no <> '';
