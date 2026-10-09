import { z } from 'zod';
import { admin, now } from './auth';
import { beijingDate } from './validation';
import { tasks } from './business';
import { getSchedule } from './schedule';
import type { Env, Identity } from './types';

const defaults = { exam:3, registration:1, duty:1, task:0, activity:1 } as const;
type Kind = keyof typeof defaults;
const kinds = Object.keys(defaults) as Kind[];
function dayDistance(date: string) {
  return Math.round((Date.parse(date.slice(0,10)+'T00:00:00+08:00')-Date.parse(beijingDate()+'T00:00:00+08:00'))/86400000);
}
function weekday(date: string) { return ['周日','周一','周二','周三','周四','周五','周六'][new Date(date+'T00:00:00+08:00').getDay()]; }

export async function reminderRules(env: Env, id: Identity) {
  const result = await env.DB.prepare('SELECT type,enabled,days_before AS daysBefore FROM reminders WHERE class_id=?').bind(id.user.classId).all<any>();
  return kinds.map(type => { const saved=result.results.find(row=>row.type===type); return {type,enabled:saved?.enabled!==0,daysBefore:saved?.daysBefore??defaults[type]}; });
}

export async function saveReminderRules(env: Env, id: Identity, input: unknown) {
  admin(id);
  const data = z.array(z.object({ type:z.enum(kinds as [Kind,...Kind[]]), enabled:z.boolean(), daysBefore:z.number().int().min(0).max(30) }).strict()).max(kinds.length).parse(input);
  if (new Set(data.map(row=>row.type)).size!==data.length) throw new Error('提醒类型不能重复');
  await env.DB.batch(data.map(row=>env.DB.prepare('INSERT INTO reminders(class_id,type,enabled,days_before) VALUES(?,?,?,?) ON CONFLICT(class_id,type) DO UPDATE SET enabled=excluded.enabled,days_before=excluded.days_before').bind(id.user.classId,row.type,row.enabled?1:0,row.daysBefore)));
  return reminderRules(env,id);
}

export async function memberReminders(env: Env, id: Identity) {
  const rules = new Map((await reminderRules(env,id)).map(row=>[row.type,row]));
  const [examResult,noticeResult,schedule,mine] = await Promise.all([
    env.DB.prepare('SELECT id,name,registration_deadline AS registrationDeadline,exam_at AS examAt FROM exams WHERE class_id=?').bind(id.user.classId).all<any>(),
    env.DB.prepare("SELECT id,title,category_id AS categoryId,source_date AS sourceDate FROM notices WHERE class_id=? AND status='published'").bind(id.user.classId).all<any>(),
    getSchedule(env,id),tasks(env,id),
  ]);
  const result:Array<{key:string;type:Kind;message:string;dueDate:string}> = [];
  const add=(type:Kind,key:string,message:string,date:string)=>{const rule=rules.get(type);if(rule?.enabled && dayDistance(date)>=0 && dayDistance(date)<=rule.daysBefore) result.push({key,type,message,dueDate:date});};
  for(const exam of examResult.results){add('exam',`exam:${exam.id}`,`${exam.name}将于${exam.examAt.slice(0,16).replace('T',' ')}举行`,exam.examAt);if(exam.registrationDeadline)add('registration',`registration:${exam.id}`,`${exam.name}报名即将截止`,exam.registrationDeadline);}
  for(const task of mine)if(task.status==='pending'&&task.dueAt)add('task',`task:${task.id}`,`待办「${task.title}」即将截止`,task.dueAt);
  for(const notice of noticeResult.results)if(notice.categoryId==='activity')add('activity',`activity:${notice.id}`,`活动通知「${notice.title}」请及时查看`,notice.sourceDate);
  const tomorrow=new Date(Date.parse(beijingDate()+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  for(const duty of schedule.duty)if(duty.name===id.user.nickname&&duty.day===weekday(tomorrow))add('duty',`duty:${tomorrow}:${duty.name}`,`明天轮到你值日`,tomorrow);
  result.sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  if(result.length)await env.DB.batch(result.map(row=>env.DB.prepare('INSERT INTO reminders_log(class_id,member_id,reminder_key,message,due_date,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(member_id,reminder_key) DO NOTHING').bind(id.user.classId,id.user.id,row.key,row.message,row.dueDate,now())));
  return result;
}
