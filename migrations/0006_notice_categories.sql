CREATE TABLE notice_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
INSERT INTO notice_categories(id,name,color,sort_order) VALUES
 ('important','重要公告','#c75b4b',1),
 ('team','组队通知','#5a8f72',2),
 ('exam','考证考试','#6d7fb2',3),
 ('activity','活动报名','#c68a43',4),
 ('daily','日常事务','#8b9d8d',5);
ALTER TABLE notices ADD COLUMN category_id TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE notices ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high'));
ALTER TABLE notices ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK(is_pinned IN (0,1));
ALTER TABLE notices ADD COLUMN source_time TEXT;
CREATE INDEX idx_notices_class_pinned ON notices(class_id,is_pinned,created_at);
