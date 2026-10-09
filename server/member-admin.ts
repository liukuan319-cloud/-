import { HTTPException } from 'hono/http-exception';
import type { Env, Identity } from './types';
import { admin, now, uuid } from './auth';

export async function changeMember(env:Env,id:Identity,memberId:string,role:'admin'|'student'|null){
 admin(id);
 const member=await env.DB.prepare('SELECT id,role FROM members WHERE id=? AND class_id=? AND deleted_at IS NULL').bind(memberId,id.user.classId).first<{id:string;role:string}>();
 if(!member)throw new HTTPException(404,{message:'成员不存在。'});
 if(role===member.role)return {ok:true,sessionRevoked:false};
 // The count is checked inside the mutation, preventing concurrent demotions/removals
 // from removing the last administrator. D1 batch also revokes sessions atomically.
 const guard=" AND (role<>'admin' OR ?='admin' OR (SELECT count(*) FROM members WHERE class_id=? AND role='admin' AND deleted_at IS NULL)>1)";
 const result=await env.DB.batch([
  env.DB.prepare((role?'UPDATE members SET role=?':'UPDATE members SET deleted_at=?')+' WHERE id=? AND class_id=? AND deleted_at IS NULL'+guard).bind(role||now(),memberId,id.user.classId,role||'',id.user.classId),
  env.DB.prepare('DELETE FROM sessions WHERE member_id=? AND changes()>0').bind(memberId),
  env.DB.prepare("UPDATE actions SET state='cancelled' WHERE member_id=? AND state='pending' AND NOT EXISTS(SELECT 1 FROM sessions WHERE member_id=?) AND EXISTS(SELECT 1 FROM members WHERE id=? AND (deleted_at IS NOT NULL OR role=?))").bind(memberId,memberId,memberId,role||''),
 ]);
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'班级必须保留至少一位班干部，或成员已被修改。'});
 await env.DB.prepare('INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),id.user.classId,id.user.id,role?'member_role:'+role:'member_remove',memberId,now()).run();
 return {ok:true,sessionRevoked:true};
}
