import { uuid, now, hash, secret } from './auth';
import type { Env } from './types';

export const initialRoster = [
  ['20260610701','田珊'],['20260610702','孙奥博'],['20260610703','赵胜男'],['20260610704','杨雨欣'],['20260610705','黄兢'],
  ['20260610706','罗振鑫'],['20260610707','牛云翔'],['20260610708','李烁阳'],['20260610709','易君起'],['20260610710','符涛'],
  ['20260610711','潘曼丹'],['20260610712','陈瑾怡'],['20260610713','李志杰'],['20260610714','林舒畅'],['20260610715','杨芷昕'],
  ['20260610716','卢子杨'],['20260610717','廖珂萱'],['20260610718','杨涵钰'],['20260610719','于子轩'],['20260610720','张万钦'],
  ['20260610721','张家睿'],['20260610722','谢禹恒'],['20260610723','余鸿胜'],['20260610724','陈嘉怡'],['20260610725','李舒可'],
  ['20260610726','徐昊楠'],['20260610727','罗羽涵'],['20260610728','张恩钒'],['20260610729','陈子轩'],['20260610730','曾志辉'],
  ['20260610731','傅元斌'],['20260610732','陈繁荣'],['20260610733','林肇浩'],['20260610734','刘晨姝'],['20260610735','蒋詹悦'],
  ['20260610736','池宛鸿'],['20260610737','徐澜珊'],['20260610738','简轩'],['20260610739','游苘蔓'],['20260610740','严安琪'],
  ['20260610741','林子航'],['20260610742','朱涛'],['20260610743','林晓婷'],['20260610744','刘宽'],['20260610745','方祺'],
  ['20260610746','王锴诺'],['20260610747','周诗语'],['20260610748','刘俊驰'],['20260610749','涂景匀'],['20260610750','张芯菁'],
] as const;

// Week seven begins 2026-10-12. Missing rooms stay empty until confirmed by staff.
export const weekSevenCourses = [
  ['周一',1,'马克思主义基本原理','文202','黄宏伟',false],['周一',3,'高等数学C（一）','文210','沈寿华',true],['周一',5,'大学体育I','东区田径场','常家宁',false],['周一',7,'材料科学概论','','Nithiwatthn Choosakul（外教）/谢秀珍',false],['周一',9,'材料工程专业英语','','谢秀珍',false],
  ['周二',1,'大学英语分级1(板块)','','',true],['周二',3,'高等数学C（一）','厚404','沈寿华',false],['周二',5,'材料工程专业英语','','谢秀珍',false],['周二',7,'材料工程专业英语','','谢秀珍',false],['周二',9,'材料科学概论','','Nithiwatthn Choosakul（外教）/谢秀珍',false],
  ['周三',1,'材料科学概论','','Nithiwatthn Choosakul（外教）/谢秀珍',false],['周三',3,'思想道德与法治','文202','刘慰',false],['周三',5,'材料工程专业英语','','谢秀珍',false],['周三',7,'形势与政策','文402','蔡立雄',true],['周三',9,'材料科学概论','','Nithiwatthn Choosakul（外教）/谢秀珍',false],
  ['周四',1,'大学英语分级1(板块)','','',false],['周四',3,'马克思主义基本原理','虚拟教室4','黄宏伟',true],['周四',9,'材料工程专业英语','','谢秀珍',false],
  ['周五',1,'国家安全教育','文202','许莫哈',false],['周五',3,'材料工程专业英语','','谢秀珍',false],['周五',5,'军事理论','厚406','梁新宇',false],['周五',7,'材料工程专业英语','','谢秀珍',false],['周五',9,'材料科学概论','','Nithiwatthn Choosakul（外教）/谢秀珍',false],
] as const;

export const semesterEvents = [
  ['2026-09-04','全体教职工正式上班',''],['2026-09-05','老生报到注册开始',''],['2026-09-06','老生报到注册结束',''],['2026-09-07','正式上课','第1周'],['2026-09-12','新生（含研究生）报到',''],['2026-09-25','中秋节',''],['2026-10-01','国庆节',''],['2026-10-26','校田径运动会','第8周，具体日期另行通知'],['2027-01-01','元旦',''],['2027-01-01','考查课程全部结束','第18周前'],['2027-01-11','期末考试周','第19周起'],['2027-01-16','寒假开始',''],
] as const;

const times = ['','08:00-08:45','08:55-09:40','10:00-10:45','10:55-11:40','14:30-15:15','15:25-16:10','16:20-17:05','17:15-18:00','19:00-19:45','19:55-20:40'];

export const INITIAL_CLASS_ID = '818122f3-4665-42b9-b7bb-448ab5a71336';

export async function seedStatements(env: Env, classId: string) {
  const statements = [env.DB.prepare('UPDATE classes SET semester_start=? WHERE id=?').bind('2026-09-07',classId)];
  for (const [number,name] of initialRoster) statements.push(env.DB.prepare('INSERT INTO members(id,class_id,nickname,student_no,role,recovery_hash,created_at,access_role) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM members WHERE class_id=? AND student_no=? AND deleted_at IS NULL)').bind(uuid(),classId,name,number,'student',await hash(secret()),now(),'student',classId,number));
  for (const [day,period,course,room,teacher,notThisWeek] of weekSevenCourses) statements.push(env.DB.prepare('INSERT INTO timetable_entries(id,class_id,weekday,period,course,room,position,week_start,period_number,teacher,not_this_week) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM timetable_entries WHERE class_id=? AND week_start=? AND weekday=? AND period_number=?)').bind(uuid(),classId,day,times[period],course,room,period,'2026-10-12',period,teacher,notThisWeek?1:0,classId,'2026-10-12',day,period));
  for (const [eventDate,title,note] of semesterEvents) statements.push(env.DB.prepare('INSERT INTO calendar_events(id,class_id,event_date,title,note,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM calendar_events WHERE class_id=? AND event_date=? AND title=?)').bind(uuid(),classId,eventDate,title,note,now(),classId,eventDate,title));
  return statements;
}

export async function seedInitialClass(env: Env, classId: string) {
  const classroom = await env.DB.prepare('SELECT id FROM classes WHERE id=?').bind(classId).first();
  if (!classroom) throw new Error('Target class does not exist');
  await env.DB.batch(await seedStatements(env,classId));
  return {members:initialRoster.length,courses:weekSevenCourses.length,events:semesterEvents.length};
}
