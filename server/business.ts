import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { admin,uuid,now } from './auth';
import { draftSchema,type Draft } from './validation';
import type { Env,Identity,Task,Notice,Action } from './types';
const fail=(message:string)=>new HTTPException(409,{message});
export async function tasks(env:Env,id:Identity):Promise<Task[]>{
 const r=await env.DB.prepare(`SELECT t.id,t.notice_id AS noticeId,t.title,t.description,t.due_at AS dueAt,t.audience,COALESCE(s.status,'pending') AS status,COALESCE(s.version,0) AS version,n.title AS noticeTitle FROM tasks t JOIN notices n ON n.id=t.notice_id LEFT JOIN task_status s ON s.task_id=t.id AND s.member_id=? WHERE t.class_id=? AND n.status='published' AND (t.audience='all' OR EXISTS(SELECT 1 FROM task_recipients r WHERE r.task_id=t.id AND r.member_id=?)) ORDER BY t.due_at IS NULL,t.due_at,t.id`).bind(id.user.id,id.user.classId,id.user.id).all<Task>();return r.results;
}
export async function notices(env:Env,id:Identity):Promise<Notice[]>{
 return (await env.DB.prepare(`SELECT n.id,n.title,n.content,n.source_date AS sourceDate,n.created_at AS createdAt,n.updated_at AS updatedAt,n.version,n.status,m.nickname AS authorName FROM notices n JOIN members m ON m.id=n.author_id WHERE n.class_id=? AND (n.status='published' OR ?='admin') ORDER BY n.created_at DESC,n.id`).bind(id.user.classId,id.user.role).all<Notice>()).results;
}
export async function notice(env:Env,id:Identity,noticeId:string){const n=(await notices(env,id)).find(n=>n.id===noticeId);if(!n)throw new HTTPException(404,{message:'通知不存在或不可访问。'});return n;}
export async function members(env:Env,id:Identity){admin(id);return (await env.DB.prepare('SELECT id,nickname,role,student_no AS studentNo,note FROM members WHERE deleted_at IS NULL AND class_id=? ORDER BY created_at,id').bind(id.user.classId).all<{id:string;nickname:string;role:string}>()).results;}
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
  sql.push(env.DB.prepare(`INSERT INTO notices(id,class_id,author_id,title,content,source_date,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(noticeId,id.user.classId,id.user.id,d.title,d.content,d.sourceDate,time,time,a.id,token));
  sql.push(env.DB.prepare(`INSERT INTO notice_versions(notice_id,version,title,content,created_at) SELECT ?,1,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(noticeId,d.title,d.content,time,a.id,token));
  for(const t of d.tasks){const taskId=uuid();sql.push(env.DB.prepare(`INSERT INTO tasks(id,notice_id,class_id,title,description,due_at,audience) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(taskId,noticeId,id.user.classId,t.title,t.description,t.dueAt,t.audience,a.id,token));if(t.memberIds.length)sql.push(env.DB.prepare(`INSERT INTO task_recipients(task_id,member_id) SELECT ?,value FROM json_each(?) WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(taskId,JSON.stringify(t.memberIds),a.id,token));}
 }else if(a.type==='task_status'){
  const p=JSON.parse(a.payload);const t=(await tasks(env,id)).find(t=>t.id===p.taskId);if(!t)throw fail('任务已撤回或不再对你开放。');if(t.version!==p.version)throw fail('任务状态已变化，请重新确认。');result={taskId:t.id,status:p.status,message:p.status==='completed'?'已记录你自报完成。':'已改回未完成。'};
  sql.push(env.DB.prepare(`UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND state='pending' AND expires_at>? AND COALESCE((SELECT version FROM task_status WHERE task_id=? AND member_id=?),0)=? AND EXISTS(SELECT 1 FROM tasks t JOIN notices n ON n.id=t.notice_id WHERE t.id=? AND n.status='published')`).bind(JSON.stringify(result),token,a.id,now(),t.id,id.user.id,p.version,t.id));
  sql.push(env.DB.prepare(`INSERT INTO task_status(task_id,member_id,status,version,updated_at) SELECT ?,?,?,1,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?) ON CONFLICT(task_id,member_id) DO UPDATE SET status=excluded.status,version=task_status.version+1,updated_at=excluded.updated_at`).bind(t.id,id.user.id,p.status,now(),a.id,token));
 }else throw new HTTPException(400,{message:'未知操作类型。'});
 sql.push(env.DB.prepare(`INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM actions WHERE id=? AND execution_token=?)`).bind(uuid(),id.user.classId,id.user.id,a.type,a.id,now(),a.id,token));
 await env.DB.batch(sql);const finished=await env.DB.prepare('SELECT state,result FROM actions WHERE id=?').bind(a.id).first<any>();if(finished?.state!=='done')throw fail('数据已变化，请重新生成确认卡。');return JSON.parse(finished.result);
}
export async function editNotice(env:Env,id:Identity,noticeId:string,input:unknown,withdraw=false){
 admin(id);const current=await notice(env,id,noticeId);const v=z.object({version:z.number().int(),title:z.string().trim().min(1).max(120).optional(),content:z.string().trim().min(1).max(12000).optional()}).parse(input);if(current.version!==v.version)throw fail('通知已被修改，请刷新。');if(current.status!=='published')throw fail('通知已撤回，不能再修改。');
 const time=now(),title=v.title??current.title,content=v.content??current.content;
 const rs=await env.DB.batch([
 env.DB.prepare(`UPDATE notices SET title=?,content=?,status=?,version=version+1,updated_at=? WHERE id=? AND class_id=? AND version=? AND status='published'`).bind(title,content,withdraw?'withdrawn':'published',time,noticeId,id.user.classId,v.version),
 env.DB.prepare(`INSERT OR IGNORE INTO notice_versions(notice_id,version,title,content,created_at) SELECT id,version,title,content,updated_at FROM notices WHERE id=? AND updated_at=?`).bind(noticeId,time),
 env.DB.prepare(`INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM notices WHERE id=? AND updated_at=?)`).bind(uuid(),id.user.classId,id.user.id,withdraw?'withdraw_notice':'edit_notice',noticeId,time,noticeId,time)
 ]);if(!rs[0].meta.changes)throw fail('通知已变化，请刷新。');return notice(env,id,noticeId);
}
