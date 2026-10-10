import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { admin,uuid,now } from './auth';
import { draftSchema,noticeCategorySchema,noticePrioritySchema } from './validation';
import type { Env,Identity,Task,Notice,Action } from './types';
import { faculty, secret } from './auth';
import { resetClass } from './class-reset';
const fail=(message:string)=>new HTTPException(409,{message});
export async function tasks(env:Env,id:Identity):Promise<Task[]>{
 const r=await env.DB.prepare(`SELECT t.id,t.notice_id AS noticeId,t.title,t.description,t.due_at AS dueAt,t.audience,COALESCE(s.status,'pending') AS status,COALESCE(s.version,0) AS version,n.title AS noticeTitle FROM tasks t JOIN notices n ON n.id=t.notice_id LEFT JOIN task_status s ON s.task_id=t.id AND s.member_id=? WHERE t.class_id=? AND n.status='published' AND (t.audience='all' OR EXISTS(SELECT 1 FROM task_recipients r WHERE r.task_id=t.id AND r.member_id=?)) ORDER BY t.due_at IS NULL,t.due_at,t.id`).bind(id.user.id,id.user.classId,id.user.id).all<Task>();return r.results;
}
export async function noticeCategories(env:Env){return (await env.DB.prepare('SELECT id,name,color FROM notice_categories ORDER BY sort_order').all<{id:string;name:string;color:string}>()).results;}
export async function notices(env:Env,id:Identity,filters:{q?:string;category?:string}={}):Promise<Notice[]>{
 const category=filters.category?noticeCategorySchema.parse(filters.category):null;
 const query=filters.q?.trim().slice(0,120).toLowerCase()||null;
 const rows=(await env.DB.prepare(`SELECT n.id,n.title,n.content,n.source_date AS sourceDate,n.source_time AS sourceTime,n.category_id AS categoryId,c.name AS categoryName,c.color AS categoryColor,n.priority,n.is_pinned AS pinned,n.created_at AS createdAt,n.updated_at AS updatedAt,n.version,n.status,m.nickname AS authorName FROM notices n JOIN members m ON m.id=n.author_id JOIN notice_categories c ON c.id=n.category_id WHERE n.class_id=? AND (n.status='published' OR ?='admin') AND (? IS NULL OR n.category_id=?) AND (? IS NULL OR LOWER(n.title) LIKE '%'||?||'%' OR LOWER(n.content) LIKE '%'||?||'%') ORDER BY n.is_pinned DESC,n.created_at DESC,n.id`).bind(id.user.classId,id.user.role,category,category,query,query,query).all<Notice>()).results;
 return rows.map(n=>({...n,pinned:Boolean(n.pinned)}));
}
export async function notice(env:Env,id:Identity,noticeId:string){const n=(await notices(env,id)).find(n=>n.id===noticeId);if(!n)throw new HTTPException(404,{message:'通知不存在或不可访问。'});return n;}
export async function members(env:Env,id:Identity){admin(id);return (await env.DB.prepare('SELECT id,nickname,access_role AS role,student_no AS studentNo,note,password_active AS passwordActive FROM members WHERE deleted_at IS NULL AND class_id=? ORDER BY created_at,id').bind(id.user.classId).all<{id:string;nickname:string;role:string}>()).results;}
export async function validateDraft(env:Env,id:Identity,input:unknown){admin(id);const d=draftSchema.parse(input);const ms=await members(env,id);const allowed=new Set(ms.map(m=>m.id));for(const t of d.tasks){if(t.memberIds.some(m=>!allowed.has(m)))throw new HTTPException(400,{message:'指定成员不属于当前班级。'});t.memberIds=t.audience==='all'?[]:[...new Set(t.memberIds)];}return d;}
export async function makeAction(env:Env,id:Identity,type:string,payload:Record<string,unknown>):Promise<Action>{
 const action={id:uuid(),type,payload,expiresAt:new Date(Date.now()+15*60000).toISOString()};await env.DB.prepare('INSERT INTO actions(id,class_id,member_id,type,payload,expires_at) VALUES(?,?,?,?,?,?)').bind(action.id,id.user.classId,id.user.id,type,JSON.stringify(payload),action.expiresAt).run();return action;
}
export async function prepareStatus(env:Env,id:Identity,input:unknown){
 const v=z.object({taskId:z.string(),status:z.enum(['pending','completed']),version:z.number().int().min(0)}).parse(input);const task=(await tasks(env,id)).find(t=>t.id===v.taskId);if(!task)throw new HTTPException(404,{message:'任务不存在或不属于你。'});if(task.version!==v.version)throw fail('任务状态已更新，请刷新后重试。');return makeAction(env,id,'task_status',{...v,title:task.title});
}
export async function progress(env:Env,id:Identity,taskId:string){
 admin(id);const t=await env.DB.prepare(`SELECT t.* FROM tasks t JOIN notices n ON n.id=t.notice_id WHERE t.id=? AND t.class_id=? AND n.status='published'`).bind(taskId,id.user.classId).first<any>();if(!t)throw new HTTPException(404,{message:'任务不存在。'});
 const ms=(await env.DB.prepare(`SELECT m.id,m.nickname,COALESCE(s.status,'pending') status FROM members m LEFT JOIN task_status s ON s.member_id=m.id AND s.task_id=? WHERE m.deleted_at IS NULL AND m.class_id=? AND (?='all' OR EXISTS(SELECT 1 FROM task_recipients r WHERE r.task_id=? AND r.member_id=m.id)) ORDER BY m.nickname`).bind(taskId,id.user.classId,t.audience,taskId).all<{id:string;nickname:string;status:string}>()).results;
 return {taskId,title:t.title,total:ms.length,completed:ms.filter(m=>m.status==='completed').length,members:ms};
}
export async function adminTasks(env:Env,id:Identity){admin(id);return (await env.DB.prepare(`SELECT t.id,t.title,t.notice_id AS noticeId,t.description,t.due_at AS dueAt,t.audience,n.title AS noticeTitle FROM tasks t JOIN notices n ON n.id=t.notice_id WHERE t.class_id=? AND n.status='published' ORDER BY t.due_at`).bind(id.user.classId).all()).results;}
export async function confirmAction(env:Env,id:Identity,actionId:string,edited?:unknown){
 const a=await env.DB.prepare('SELECT * FROM actions WHERE id=? AND member_id=? AND class_id=?').bind(actionId,id.user.id,id.user.classId).first<any>();if(!a)throw new HTTPException(404,{message:'操作不存在或不属于你。'});
 if(a.state==='done')return JSON.parse(a.result);if(a.expires_at<now())throw fail('确认卡已过期，请重新生成。');
 const token=uuid();let result:Record<string,unknown>;let sql:D1PreparedStatement[]=[];
 if(a.type==='publish_notice'){
  const d=await validateDraft(env,id,edited??JSON.parse(a.payload));const noticeId=uuid(),time=now();result={noticeId,message:'通知已发布，相关同学现在可以看到待办。'};
  sql.push(env.DB.prepare(`UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?`).bind(JSON.stringify(result),token,a.id,time));
  sql.push(env.DB.prepare(`INSERT INTO notices(id,class_id,author_id,title,content,source_date,source_time,category_id,priority,is_pinned,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(noticeId,id.user.classId,id.user.id,d.title,d.content,d.sourceDate,d.sourceTime,d.categoryId,d.priority,d.pinned?1:0,time,time,a.id,token));
  sql.push(env.DB.prepare(`INSERT INTO notice_versions(notice_id,version,title,content,created_at) SELECT ?,1,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(noticeId,d.title,d.content,time,a.id,token));
  for(const t of d.tasks){const taskId=uuid();sql.push(env.DB.prepare(`INSERT INTO tasks(id,notice_id,class_id,title,description,due_at,audience) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(taskId,noticeId,id.user.classId,t.title,t.description,t.dueAt,t.audience,a.id,token));if(t.memberIds.length)sql.push(env.DB.prepare(`INSERT INTO task_recipients(task_id,member_id) SELECT ?,value FROM json_each(?) WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(taskId,JSON.stringify(t.memberIds),a.id,token));}
 }else if(a.type==='task_status'){
  const p=JSON.parse(a.payload);const t=(await tasks(env,id)).find(t=>t.id===p.taskId);if(!t)throw fail('任务已撤回或不再对你开放。');if(t.version!==p.version)throw fail('任务状态已变化，请重新确认。');result={taskId:t.id,status:p.status,message:p.status==='completed'?'已记录你自报完成。':'已改回未完成。'};
  sql.push(env.DB.prepare(`UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>? AND COALESCE((SELECT version FROM task_status WHERE task_id=? AND member_id=?),0)=? AND EXISTS(SELECT 1 FROM tasks t JOIN notices n ON n.id=t.notice_id WHERE t.id=? AND n.status='published')`).bind(JSON.stringify(result),token,a.id,now(),t.id,id.user.id,p.version,t.id));
  sql.push(env.DB.prepare(`INSERT INTO task_status(task_id,member_id,status,version,updated_at) SELECT ?,?,?,1,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?) ON CONFLICT(task_id,member_id) DO UPDATE SET status=excluded.status,version=task_status.version+1,updated_at=excluded.updated_at`).bind(t.id,id.user.id,p.status,now(),a.id,token));
 }else if(a.type==='personal_tasks_create'){
  const p=z.object({tasks:z.array(z.object({title:z.string().trim().min(1).max(120),note:z.string().max(1000),dueAt:z.iso.datetime({offset:true}).nullable()}).strict()).min(1).max(10)}).strict().parse(JSON.parse(a.payload));
  result={created:p.tasks.length,message:`已创建 ${p.tasks.length} 条个人待办。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  for(const task of p.tasks)sql.push(env.DB.prepare('INSERT INTO personal_tasks(id,class_id,member_id,title,note,due_at,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(uuid(),id.user.classId,id.user.id,task.title,task.note,task.dueAt,now(),now(),a.id,token));
 }else if(a.type==='personal_task_status'){
  const p=z.object({taskId:z.string(),status:z.enum(['pending','completed'])}).strict().parse(JSON.parse(a.payload));
  const task=await env.DB.prepare('SELECT id FROM personal_tasks WHERE id=? AND class_id=? AND member_id=?').bind(p.taskId,id.user.classId,id.user.id).first();
  if(!task)throw fail('个人待办已删除或不属于你。');
  result={taskId:p.taskId,status:p.status,message:p.status==='completed'?'已标记完成。':'已改回待完成。'};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('UPDATE personal_tasks SET status=?,updated_at=? WHERE id=? AND class_id=? AND member_id=? AND EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(p.status,now(),p.taskId,id.user.classId,id.user.id,a.id,token));
 }else if(a.type==='create_vote'){
  const p=z.object({title:z.string().trim().min(1).max(120),description:z.string().trim().max(2000),closesAt:z.iso.datetime({offset:true}),options:z.array(z.string().trim().min(1).max(120)).min(2).max(12)}).strict().parse(JSON.parse(a.payload));
  admin(id); if(Date.parse(p.closesAt)<=Date.now())throw fail('投票截止时间必须在未来。');
  const voteId=uuid();
  result={voteId,message:`已发起投票《${p.title}》。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('INSERT INTO votes(id,class_id,author_id,title,description,anonymous,salt,closes_at,created_at) SELECT ?,?,?,?,?,1,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(voteId,id.user.classId,id.user.id,p.title,p.description,secret(),p.closesAt,now(),a.id,token));
  for(const [position,label] of p.options.entries())sql.push(env.DB.prepare('INSERT INTO vote_options(id,vote_id,label,position) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(uuid(),voteId,label,position,a.id,token));
 }else if(a.type==='schedule_add'){
  admin(id);const p=z.object({day:z.enum(['周一','周二','周三','周四','周五','周六','周日']),time:z.string().trim().min(1).max(40),course:z.string().trim().min(1).max(120),room:z.string().trim().max(120),teacher:z.string().trim().max(120)}).strict().parse(JSON.parse(a.payload));
  result={message:`已录入${p.day}的${p.course}。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('INSERT INTO timetable_entries(id,class_id,weekday,period,course,room,teacher,position) SELECT ?,?,?,?,?,?,?,COALESCE((SELECT MAX(position)+1 FROM timetable_entries WHERE class_id=?),0) WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(uuid(),id.user.classId,p.day,p.time,p.course,p.room,p.teacher,id.user.classId,a.id,token));
 }else if(a.type==='duty_add'){
  admin(id);const p=z.object({day:z.enum(['周一','周二','周三','周四','周五','周六','周日']),memberName:z.string(),memberId:z.string()}).strict().parse(JSON.parse(a.payload));
  const target=await env.DB.prepare('SELECT id FROM members WHERE id=? AND class_id=? AND deleted_at IS NULL AND nickname=?').bind(p.memberId,id.user.classId,p.memberName).first();if(!target)throw fail('值日成员已变化，请重新确认。');
  result={message:`已录入${p.day}值日：${p.memberName}。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('INSERT INTO duty_entries(id,class_id,weekday,member_id,position) SELECT ?,?,?,?,COALESCE((SELECT MAX(position)+1 FROM duty_entries WHERE class_id=?),0) WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(uuid(),id.user.classId,p.day,p.memberId,id.user.classId,a.id,token));
 }else if(a.type==='exam_add'){
  admin(id);const p=z.object({name:z.string().trim().min(1).max(120),category:z.string().trim().min(1).max(80),examAt:z.iso.datetime({offset:true}),registrationDeadline:z.iso.datetime({offset:true}).nullable(),note:z.string().trim().max(1000)}).strict().parse(JSON.parse(a.payload));
  result={message:`已录入考试《${p.name}》。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('INSERT INTO exams(id,class_id,name,category,registration_deadline,exam_at,note,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(uuid(),id.user.classId,p.name,p.category,p.registrationDeadline,p.examAt,p.note,now(),a.id,token));
 }else if(a.type==='calendar_event_add'){
  admin(id);const p=z.object({eventDate:z.iso.date(),title:z.string().trim().min(1).max(120),note:z.string().trim().max(500)}).strict().parse(JSON.parse(a.payload));
  result={message:`已录入校历节点《${p.title}》。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('INSERT INTO calendar_events(id,class_id,event_date,title,note,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(uuid(),id.user.classId,p.eventDate,p.title,p.note,now(),a.id,token));
 }else if(a.type==='student_import'){
  admin(id);const p=z.object({name:z.string().trim().min(1).max(24),studentNo:z.string().trim().min(1).max(64),note:z.string().trim().max(500)}).strict().parse(JSON.parse(a.payload));
  const conflict=await env.DB.prepare('SELECT id FROM members WHERE deleted_at IS NULL AND (student_no=? OR (class_id=? AND nickname=?))').bind(p.studentNo,id.user.classId,p.name).first();
  if(conflict)throw fail('姓名或学号已在名单中。');
  result={message:`已将${p.name}加入本班名单，等待激活。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('INSERT INTO members(id,class_id,nickname,student_no,role,note,recovery_hash,created_at,access_role) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(uuid(),id.user.classId,p.name,p.studentNo,'student',p.note,uuid(),now(),'student',a.id,token));
 }else if(a.type==='grade_set'){
  admin(id);const p=z.object({memberName:z.string(),courseName:z.string(),semester:z.string(),score:z.number().finite().min(0).max(100),memberId:z.string(),courseId:z.string()}).strict().parse(JSON.parse(a.payload));
  const member=await env.DB.prepare('SELECT id FROM members WHERE id=? AND class_id=? AND nickname=? AND deleted_at IS NULL').bind(p.memberId,id.user.classId,p.memberName).first();
  const course=await env.DB.prepare('SELECT id FROM academic_courses WHERE id=? AND class_id=? AND name=? AND semester=?').bind(p.courseId,id.user.classId,p.courseName,p.semester).first();
  if(!member||!course)throw fail('成员或课程已变化，请重新确认。');
  result={message:`已录入${p.memberName}的${p.courseName}成绩。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('INSERT INTO academic_grades(course_id,member_id,score,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?) ON CONFLICT(course_id,member_id) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at').bind(p.courseId,p.memberId,p.score,now(),a.id,token));
 }else if(a.type==='member_role'){
  faculty(id); const p=z.object({memberId:z.string(),memberName:z.string(),role:z.enum(['cadre','student'])}).strict().parse(JSON.parse(a.payload));
  const target=await env.DB.prepare('SELECT id FROM members WHERE id=? AND class_id=? AND deleted_at IS NULL AND access_role<>?').bind(p.memberId,id.user.classId,'faculty').first(); if(!target)throw fail('成员已变化或不属于当前班级。');
  result={message:`已将${p.memberName}设为${p.role==='cadre'?'班干部':'学生'}。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare("UPDATE members SET role=?,access_role=? WHERE id=? AND class_id=? AND deleted_at IS NULL AND access_role<>'faculty' AND EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)").bind(p.role==='cadre'?'admin':'student',p.role,p.memberId,id.user.classId,a.id,token));
  sql.push(env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('invalid-json','$') END"));
  sql.push(env.DB.prepare('DELETE FROM sessions WHERE member_id=? AND EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(p.memberId,a.id,token));
 }else if(a.type==='password_reset'){
  admin(id); const p=z.object({memberId:z.string(),memberName:z.string()}).strict().parse(JSON.parse(a.payload));
  const target=await env.DB.prepare('SELECT access_role AS role FROM members WHERE id=? AND class_id=? AND deleted_at IS NULL').bind(p.memberId,id.user.classId).first<{role:string}>();
  if(!target||target.role==='faculty'||(id.user.accessRole!=='faculty'&&target.role!=='student'))throw fail('成员已变化或无权重置密码。');
  result={message:`已重置${p.memberName}的密码。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('UPDATE members SET password_hash=NULL,password_active=0,failed_attempts=0,locked_until=NULL WHERE id=? AND class_id=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(p.memberId,id.user.classId,a.id,token));
  sql.push(env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('invalid-json','$') END"));
  sql.push(env.DB.prepare('DELETE FROM sessions WHERE member_id=? AND EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(p.memberId,a.id,token));
 }else if(a.type==='class_name'){
  faculty(id); const p=z.object({name:z.string().trim().min(1).max(80)}).strict().parse(JSON.parse(a.payload)); result={message:`班级名称已改为${p.name}。`};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('UPDATE classes SET name=? WHERE id=? AND EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(p.name,id.user.classId,a.id,token));
 }else if(a.type==='invite_rotate'){
  faculty(id); const code=secret().slice(0,10).toUpperCase(); result={inviteCode:code,message:'邀请码已更新，旧邀请码已失效。'};
  sql.push(env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>?").bind(JSON.stringify(result),token,a.id,now()));
  sql.push(env.DB.prepare('UPDATE classes SET invite_code=? WHERE id=? AND EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)').bind(code,id.user.classId,a.id,token));
 }else if(a.type==='class_reset'){
  faculty(id); return resetClass(env,id,'清空本班数据',{id:a.id,token});
 }else throw new HTTPException(400,{message:'未知操作类型。'});
 sql.push(env.DB.prepare(`INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(uuid(),id.user.classId,id.user.id,a.type,a.id,now(),a.id,token));
 await env.DB.batch(sql);const finished=await env.DB.prepare('SELECT state,result FROM actions WHERE id=?').bind(a.id).first<any>();if(finished?.state!=='done')throw fail('数据已变化，请重新生成确认卡。');return JSON.parse(finished.result);
}
export async function editNotice(env:Env,id:Identity,noticeId:string,input:unknown,withdraw=false){
 admin(id);const current=await notice(env,id,noticeId);const v=z.object({version:z.number().int(),title:z.string().trim().min(1).max(120).optional(),content:z.string().trim().min(1).max(12000).optional(),sourceDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),sourceTime:z.string().datetime({offset:true}).nullable().optional(),categoryId:noticeCategorySchema.optional(),priority:noticePrioritySchema.optional(),pinned:z.boolean().optional()}).parse(input);if(current.version!==v.version)throw fail('通知已被修改，请刷新。');if(current.status!=='published')throw fail('通知已撤回，不能再修改。');
 const time=now(),title=v.title??current.title,content=v.content??current.content,categoryId=v.categoryId??current.categoryId,pinned=v.pinned??current.pinned;
 if(pinned&&categoryId!=='important')throw new HTTPException(400,{message:'只有重要公告可以置顶。'});
 const rs=await env.DB.batch([
 env.DB.prepare(`UPDATE notices SET title=?,content=?,source_date=?,source_time=?,category_id=?,priority=?,is_pinned=?,status=?,version=version+1,updated_at=? WHERE id=? AND class_id=? AND version=? AND status='published'`).bind(title,content,v.sourceDate??current.sourceDate,v.sourceTime===undefined?current.sourceTime:v.sourceTime,categoryId,v.priority??current.priority,pinned?1:0,withdraw?'withdrawn':'published',time,noticeId,id.user.classId,v.version),
 env.DB.prepare(`INSERT OR IGNORE INTO notice_versions(notice_id,version,title,content,created_at) SELECT id,version,title,content,updated_at FROM notices WHERE id=? AND updated_at=?`).bind(noticeId,time),
 env.DB.prepare(`INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM notices WHERE id=? AND updated_at=?)`).bind(uuid(),id.user.classId,id.user.id,withdraw?'withdraw_notice':'edit_notice',noticeId,time,noticeId,time)
 ]);if(!rs[0].meta.changes)throw fail('通知已变化，请刷新。');return notice(env,id,noticeId);
}
