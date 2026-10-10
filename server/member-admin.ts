import { HTTPException } from 'hono/http-exception';
import type { Env, Identity } from './types';
import { admin, faculty, now, uuid } from './auth';
import { hashPassword } from './accounts';
import { usernameSchema } from './accounts';

export async function changeMember(env:Env,id:Identity,memberId:string,role:'admin'|'student'|null){
 admin(id);
 const member=await env.DB.prepare('SELECT id,role,access_role AS accessRole FROM members WHERE id=? AND class_id=? AND deleted_at IS NULL').bind(memberId,id.user.classId).first<{id:string;role:string;accessRole:string}>();
 if(!member)throw new HTTPException(404,{message:'成员不存在。'});
 if(role!==null)faculty(id);
 if(id.user.accessRole!=='faculty'&&member.accessRole!=='student')throw new HTTPException(403,{message:'班干部只能管理学生。'});
 if(member.accessRole==='faculty')throw new HTTPException(403,{message:'请通过变更辅导员功能转交班级。'});
 if(role===member.role)return {ok:true,sessionRevoked:false};
 // The count is checked inside the mutation, preventing concurrent demotions/removals
 // from removing the last administrator. D1 batch also revokes sessions atomically.
 const guard=" AND (role<>'admin' OR ?='admin' OR (SELECT count(*) FROM members WHERE class_id=? AND role='admin' AND deleted_at IS NULL)>1)";
 const result=await env.DB.batch([
  env.DB.prepare((role?'UPDATE members SET role=?,access_role=?':'UPDATE members SET deleted_at=?')+' WHERE id=? AND class_id=? AND deleted_at IS NULL'+guard).bind(...(role?[role,role==='admin'?'cadre':'student']:[now()]),memberId,id.user.classId,role||'',id.user.classId),
  env.DB.prepare('DELETE FROM sessions WHERE member_id=? AND changes()>0').bind(memberId),
  env.DB.prepare("UPDATE actions SET state='cancelled' WHERE member_id=? AND state='pending' AND NOT EXISTS(SELECT 1 FROM sessions WHERE member_id=?) AND EXISTS(SELECT 1 FROM members WHERE id=? AND (deleted_at IS NOT NULL OR role=?))").bind(memberId,memberId,memberId,role||''),
 ]);
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'班级必须保留至少一位班干部，或成员已被修改。'});
 await env.DB.prepare('INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),id.user.classId,id.user.id,role?'member_role:'+role:'member_remove',memberId,now()).run();
 return {ok:true,sessionRevoked:true};
}

export async function resetMemberPassword(env:Env,id:Identity,memberId:string){
 admin(id);
 const target=await env.DB.prepare('SELECT id,access_role AS accessRole FROM members WHERE id=? AND class_id=? AND deleted_at IS NULL').bind(memberId,id.user.classId).first<{id:string;accessRole:string}>();
 if(!target)throw new HTTPException(404,{message:'成员不存在。'});
 if(target.accessRole==='faculty'||(id.user.accessRole!=='faculty'&&target.accessRole!=='student'))throw new HTTPException(403,{message:'无权重置该成员密码。'});
 await env.DB.batch([
  env.DB.prepare('UPDATE members SET password_hash=NULL,password_active=0,failed_attempts=0,locked_until=NULL WHERE id=? AND class_id=?').bind(memberId,id.user.classId),
  env.DB.prepare('DELETE FROM sessions WHERE member_id=?').bind(memberId),
  env.DB.prepare('INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),id.user.classId,id.user.id,'password_reset',memberId,now()),
 ]);
 return {ok:true};
}

export async function changeOwnPassword(env:Env,id:Identity,current:string,next:string){
 const account=await env.DB.prepare('SELECT password_hash FROM members WHERE id=? AND class_id=? AND deleted_at IS NULL').bind(id.user.id,id.user.classId).first<{password_hash:string|null}>();
 if(!account)throw new HTTPException(401,{message:'账号不存在。'});
 const {verifyPassword}=await import('./accounts');
 if(!await verifyPassword(current,account.password_hash))throw new HTTPException(403,{message:'当前密码不正确。'});
 await env.DB.prepare('UPDATE members SET password_hash=? WHERE id=?').bind(await hashPassword(next),id.user.id).run();
 return {ok:true};
}

export async function transferFaculty(env:Env,id:Identity,memberId:string,username:string){
 faculty(id);
 const name=usernameSchema.parse(username);
 if(memberId===id.user.id)throw new HTTPException(400,{message:'请选择另一位已激活的本班成员。'});
 const target=await env.DB.prepare('SELECT id,password_active FROM members WHERE id=? AND class_id=? AND deleted_at IS NULL AND access_role IN (?,?)').bind(memberId,id.user.classId,'student','cadre').first<{id:string;password_active:number}>();
 if(!target?.password_active)throw new HTTPException(400,{message:'新辅导员须先激活账号。'});
 const occupied=await env.DB.prepare('SELECT id FROM members WHERE username=? AND deleted_at IS NULL').bind(name).first();
 if(occupied)throw new HTTPException(409,{message:'辅导员账号已被使用。'});
 const time=now();
 try{await env.DB.batch([
  env.DB.prepare('UPDATE members SET deleted_at=? WHERE id=? AND class_id=? AND access_role=? AND deleted_at IS NULL').bind(time,id.user.id,id.user.classId,'faculty'),
  env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('invalid-json','$') END"),
  env.DB.prepare('UPDATE members SET role=?,access_role=?,username=?,student_no=NULL WHERE id=? AND class_id=? AND deleted_at IS NULL AND password_active=1').bind('admin','faculty',name,memberId,id.user.classId),
  env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('invalid-json','$') END"),
  env.DB.prepare('DELETE FROM sessions WHERE member_id IN (?,?)').bind(id.user.id,memberId),
  env.DB.prepare("UPDATE actions SET state='cancelled' WHERE member_id IN (?,?) AND state='pending'").bind(id.user.id,memberId),
  env.DB.prepare('INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),id.user.classId,id.user.id,'faculty_transfer',memberId,time),
 ]);}catch{throw new HTTPException(409,{message:'移交未完成，请检查账号是否重复或成员状态是否变化。'});}
 return {ok:true};
}
