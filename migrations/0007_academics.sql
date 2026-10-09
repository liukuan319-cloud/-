CREATE TABLE academic_targets (
 class_id TEXT PRIMARY KEY REFERENCES classes(id),
 required REAL NOT NULL DEFAULT 0 CHECK(required >= 0),
 elective REAL NOT NULL DEFAULT 0 CHECK(elective >= 0),
 general REAL NOT NULL DEFAULT 0 CHECK(general >= 0)
);
CREATE TABLE academic_courses (
 id TEXT PRIMARY KEY,
 class_id TEXT NOT NULL REFERENCES classes(id),
 name TEXT NOT NULL,
 semester TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('required','elective','general')),
 credits REAL NOT NULL CHECK(credits > 0 AND credits <= 30),
 UNIQUE(class_id,semester,name)
);
CREATE INDEX idx_academic_courses_class ON academic_courses(class_id,semester);
CREATE TABLE academic_grades (
 course_id TEXT NOT NULL REFERENCES academic_courses(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id),
 score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(course_id,member_id)
);
CREATE INDEX idx_academic_grades_member ON academic_grades(member_id);
CREATE TABLE academic_comprehensive (
 class_id TEXT NOT NULL REFERENCES classes(id),
 member_id TEXT NOT NULL REFERENCES members(id),
 semester TEXT NOT NULL,
 module TEXT NOT NULL CHECK(module IN ('moral','intellectual','physical','aesthetic','labor')),
 score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(class_id,member_id,semester,module)
);
CREATE INDEX idx_academic_comprehensive_member ON academic_comprehensive(member_id,semester);
