import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { now, uuid } from './auth';
import type { Env, Identity } from './types';

const taskInput = z.object({ title:z.string().trim().min(1).max(120),note:z.string().trim().max(1000).default(''),dueAt:z.iso.datetime({offset:true}).nullable().default(null) }).strict();

export async function personalTasks(env:Env,id:Identity){
 return (await env.DB.prepare('SELECT id,title,note,due_at AS dueAt,status,created_at AS createdAt FROM personal_tasks WHERE class_id=? AND member_id=? ORDER BY status,due_at IS NULL,due_at,created_at').bind(id.user.classId,id.user.id).all()).results;
}
export async function addPersonalTask(env:Env,id:Identity,input:unknown){
 const row=taskInput.parse(input),taskId=uuid(),time=now();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO personal_tasks(id,class_id,member_id,title,note,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(taskId,id.user.classId,id.user.id,row.title,row.note,row.dueAt,time,time),
  env.DB.prepare('INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),id.user.classId,id.user.id,'personal_task_create',taskId,time),
 ]);
 return {id:taskId,...row,status:'pending'};
}
export async function setPersonalTaskStatus(env:Env,id:Identity,taskId:string,input:unknown){
 const {status}=z.object({status:z.enum(['pending','completed'])}).strict().parse(input);
 const result=await env.DB.prepare('UPDATE personal_tasks SET status=?,updated_at=? WHERE id=? AND class_id=? AND member_id=?').bind(status,now(),taskId,id.user.classId,id.user.id).run();
 if(!result.meta.changes)throw new HTTPException(404,{message:'待办不存在。'});
 await env.DB.prepare('INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),id.user.classId,id.user.id,'personal_task_status:'+status,taskId,now()).run();
 return {ok:true,status};
}
