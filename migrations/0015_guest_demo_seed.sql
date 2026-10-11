INSERT INTO classes(id,name,invite_code,is_demo,created_at,semester_start)
VALUES('demo-class-v1','演示班级','DEMO-NOT-FOR-LOGIN',1,'2026-10-01T00:00:00+08:00','2026-09-01');
INSERT INTO members(id,class_id,nickname,role,recovery_hash,created_at,student_no,access_role) VALUES
('demo-faculty','demo-class-v1','陈老师','admin','demo-recovery-faculty','2026-10-01T00:00:00+08:00','20260001','faculty'),
('demo-cadre-1','demo-class-v1','林同学','admin','demo-recovery-cadre-1','2026-10-01T00:01:00+08:00','20260002','cadre'),
('demo-cadre-2','demo-class-v1','周同学','admin','demo-recovery-cadre-2','2026-10-01T00:02:00+08:00','20260003','cadre'),
('demo-guest','demo-class-v1','访客同学','student','demo-recovery-guest','2026-10-01T00:03:00+08:00','20260004','student'),
('demo-student-1','demo-class-v1','张同学','student','demo-recovery-student-1','2026-10-01T00:04:00+08:00','20260005','student'),
('demo-student-2','demo-class-v1','李同学','student','demo-recovery-student-2','2026-10-01T00:05:00+08:00','20260006','student'),
('demo-student-3','demo-class-v1','王同学','student','demo-recovery-student-3','2026-10-01T00:06:00+08:00','20260007','student'),
('demo-student-4','demo-class-v1','赵同学','student','demo-recovery-student-4','2026-10-01T00:07:00+08:00','20260008','student'),
('demo-student-5','demo-class-v1','孙同学','student','demo-recovery-student-5','2026-10-01T00:08:00+08:00','20260009','student'),
('demo-student-6','demo-class-v1','吴同学','student','demo-recovery-student-6','2026-10-01T00:09:00+08:00','20260010','student'),
('demo-student-7','demo-class-v1','郑同学','student','demo-recovery-student-7','2026-10-01T00:10:00+08:00','20260011','student'),
('demo-student-8','demo-class-v1','许同学','student','demo-recovery-student-8','2026-10-01T00:11:00+08:00','20260012','student');

INSERT INTO notices(id,class_id,author_id,title,content,source_date,status,created_at,updated_at,category_id,priority,is_pinned) VALUES
('demo-notice-1','demo-class-v1','demo-faculty','本周班会安排','本周三 16:00 在教学楼 A201 举行班会，请提前十分钟到场。','2026-10-10','published','2026-10-10T09:00:00+08:00','2026-10-10T09:00:00+08:00','important','high',1),
('demo-notice-2','demo-class-v1','demo-cadre-1','创新竞赛组队','创新竞赛拟组建两个小组，有意参加的同学请在 10 月 15 日前联系林同学。','2026-10-09','published','2026-10-09T11:00:00+08:00','2026-10-09T11:00:00+08:00','team','normal',0),
('demo-notice-3','demo-class-v1','demo-faculty','英语等级考试报名','英语等级考试报名截止 10 月 20 日 18:00，考试定于 12 月 12 日。请核对报名信息。','2026-10-08','published','2026-10-08T08:00:00+08:00','2026-10-08T08:00:00+08:00','exam','high',0),
('demo-notice-4','demo-class-v1','demo-cadre-2','秋季读书会报名','秋季读书会在 10 月 18 日举行，报名请在 10 月 16 日前告知周同学。','2026-10-07','published','2026-10-07T14:00:00+08:00','2026-10-07T14:00:00+08:00','activity','normal',0),
('demo-notice-5','demo-class-v1','demo-faculty','课堂反馈表','请同学们在 10 月 14 日 20:00 前填写课堂反馈表。','2026-10-06','published','2026-10-06T09:00:00+08:00','2026-10-06T09:00:00+08:00','daily','normal',0),
('demo-notice-6','demo-class-v1','demo-cadre-1','图书馆志愿值班','本周五下午安排图书馆志愿值班，请按值日表到岗。','2026-10-05','published','2026-10-05T10:00:00+08:00','2026-10-05T10:00:00+08:00','daily','normal',0),
('demo-notice-7','demo-class-v1','demo-faculty','计算机等级考试提醒','计算机等级考试报名将于 11 月 1 日截止，考试时间为 12 月 20 日。','2026-10-04','published','2026-10-04T09:00:00+08:00','2026-10-04T09:00:00+08:00','exam','normal',0);
INSERT INTO notice_versions(notice_id,version,title,content,created_at)
SELECT id,1,title,content,created_at FROM notices WHERE class_id='demo-class-v1';
INSERT INTO tasks(id,notice_id,class_id,title,description,due_at,audience) VALUES
('demo-task-1','demo-notice-1','demo-class-v1','参加本周班会','教学楼 A201，提前十分钟到场','2026-10-14T16:00:00+08:00','all'),
('demo-task-2','demo-notice-2','demo-class-v1','报名创新竞赛组队','联系林同学','2026-10-15T23:59:00+08:00','all'),
('demo-task-3','demo-notice-3','demo-class-v1','核对英语等级考试报名','完成报名信息核对','2026-10-20T18:00:00+08:00','all'),
('demo-task-4','demo-notice-4','demo-class-v1','报名秋季读书会','联系周同学','2026-10-16T23:59:00+08:00','all'),
('demo-task-5','demo-notice-5','demo-class-v1','填写课堂反馈表','提交课堂反馈表','2026-10-14T20:00:00+08:00','all');
INSERT INTO timetable_entries(id,class_id,weekday,period,course,room,position,period_number,teacher) VALUES
('demo-course-1','demo-class-v1','周一','08:00-09:40','高等数学','A301',1,1,'王老师'),
('demo-course-2','demo-class-v1','周二','10:00-11:40','大学英语','B204',2,2,'林老师'),
('demo-course-3','demo-class-v1','周三','08:00-09:40','计算机基础','机房 2',3,1,'周老师'),
('demo-course-4','demo-class-v1','周四','14:00-15:40','物理实验','实验楼 101',4,3,'陈老师'),
('demo-course-5','demo-class-v1','周五','10:00-11:40','创新实践','C305',5,2,'吴老师');
INSERT INTO duty_entries(id,class_id,weekday,member_id,position) VALUES
('demo-duty-1','demo-class-v1','周一','demo-student-1',1),('demo-duty-2','demo-class-v1','周二','demo-student-2',2),
('demo-duty-3','demo-class-v1','周三','demo-guest',3),('demo-duty-4','demo-class-v1','周四','demo-student-3',4),
('demo-duty-5','demo-class-v1','周五','demo-student-4',5);
INSERT INTO calendar_events(id,class_id,event_date,title,note,created_at) VALUES
('demo-event-1','demo-class-v1','2026-09-01','秋季学期开学','演示校历','2026-10-01T00:00:00+08:00'),
('demo-event-2','demo-class-v1','2026-10-14','班会','教学楼 A201','2026-10-01T00:00:00+08:00'),
('demo-event-3','demo-class-v1','2027-01-18','寒假开始','以学校正式通知为准','2026-10-01T00:00:00+08:00');
INSERT INTO exams(id,class_id,name,category,registration_deadline,exam_at,note,created_at) VALUES
('demo-exam-1','demo-class-v1','英语等级考试','考证','2026-10-20T18:00:00+08:00','2026-12-12T09:00:00+08:00','演示安排','2026-10-01T00:00:00+08:00'),
('demo-exam-2','demo-class-v1','计算机等级考试','考证','2026-11-01T18:00:00+08:00','2026-12-20T09:00:00+08:00','演示安排','2026-10-01T00:00:00+08:00');
INSERT INTO votes(id,class_id,author_id,title,description,anonymous,salt,closes_at,ended_at,created_at) VALUES
('demo-vote-1','demo-class-v1','demo-cadre-1','班会分享主题','选择你感兴趣的班会分享主题',1,'demo-vote-salt-1','2027-12-31T18:00:00+08:00',NULL,'2026-10-10T12:00:00+08:00'),
('demo-vote-2','demo-class-v1','demo-cadre-2','秋游地点选择','演示已结束投票结果',1,'demo-vote-salt-2','2026-10-08T18:00:00+08:00','2026-10-08T18:00:00+08:00','2026-10-05T12:00:00+08:00');
INSERT INTO vote_options(id,vote_id,label,position) VALUES
('demo-option-1','demo-vote-1','学习经验',1),('demo-option-2','demo-vote-1','竞赛分享',2),
('demo-option-3','demo-vote-2','植物园',1),('demo-option-4','demo-vote-2','科技馆',2);
INSERT INTO vote_records(vote_id,voter_hash,member_id,option_id,created_at) VALUES
('demo-vote-2','demo-voter-1',NULL,'demo-option-3','2026-10-07T10:00:00+08:00'),
('demo-vote-2','demo-voter-2',NULL,'demo-option-3','2026-10-07T10:01:00+08:00'),
('demo-vote-2','demo-voter-3',NULL,'demo-option-4','2026-10-07T10:02:00+08:00');
INSERT INTO personal_tasks(id,class_id,member_id,title,note,due_at,status,created_at,updated_at) VALUES
('demo-personal-1','demo-class-v1','demo-guest','查看本周课程表','演示每日待办','2026-10-14T08:00:00+08:00','pending','2026-10-10T09:00:00+08:00','2026-10-10T09:00:00+08:00'),
('demo-personal-2','demo-class-v1','demo-guest','准备班会分享','演示每日待办','2026-10-14T16:00:00+08:00','pending','2026-10-10T09:01:00+08:00','2026-10-10T09:01:00+08:00'),
('demo-personal-3','demo-class-v1','demo-guest','阅读英语考试通知','演示每日待办','2026-10-20T18:00:00+08:00','pending','2026-10-10T09:02:00+08:00','2026-10-10T09:02:00+08:00'),
('demo-personal-4','demo-class-v1','demo-guest','确认值日安排','演示每日待办','2026-10-14T12:00:00+08:00','pending','2026-10-10T09:03:00+08:00','2026-10-10T09:03:00+08:00');
