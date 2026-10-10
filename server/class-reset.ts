import { HTTPException } from 'hono/http-exception';
import type { Env, Identity } from './types';
import { faculty, now, uuid } from './auth';
import { INITIAL_CLASS_ID, seedStatements } from './initialization';

export async function resetClass(env:Env,id:Identity,confirmation:string,action?:{id:string;token:string}){
 faculty(id);
 if(confirmation!=='清空本班数据')throw new HTTPException(400,{message:'请填写确认文字。'});
 const classId=id.user.classId;
 const statements=action ? [
  env.DB.prepare("UPDATE actions SET state='done',result=?,execution_token=? WHERE id=? AND member_id=? AND class_id=? AND state='pending' AND expires_at>?").bind(JSON.stringify({ok:true,seeded:classId===INITIAL_CLASS_ID,message:'班级数据已清空并重建。'}),action.token,action.id,id.user.id,classId,now()),
  env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json_extract('invalid-json','$') END"),
 ] : [];
 statements.push(
  env.DB.prepare('DELETE FROM vote_records WHERE vote_id IN (SELECT id FROM votes WHERE class_id=?)').bind(classId),
  env.DB.prepare('DELETE FROM vote_options WHERE vote_id IN (SELECT id FROM votes WHERE class_id=?)').bind(classId),
  env.DB.prepare('DELETE FROM votes WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM task_status WHERE task_id IN (SELECT id FROM tasks WHERE class_id=?)').bind(classId),
  env.DB.prepare('DELETE FROM task_recipients WHERE task_id IN (SELECT id FROM tasks WHERE class_id=?)').bind(classId),
  env.DB.prepare('DELETE FROM tasks WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM notice_versions WHERE notice_id IN (SELECT id FROM notices WHERE class_id=?)').bind(classId),
  env.DB.prepare('DELETE FROM notices WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM academic_grades WHERE course_id IN (SELECT id FROM academic_courses WHERE class_id=?)').bind(classId),
  env.DB.prepare('DELETE FROM academic_comprehensive WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM academic_courses WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM academic_targets WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM exams WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM reminders_log WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM reminders WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM duty_entries WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM timetable_entries WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM personal_tasks WHERE class_id=?').bind(classId),
  env.DB.prepare('DELETE FROM messages WHERE member_id IN (SELECT id FROM members WHERE class_id=?)').bind(classId),
  env.DB.prepare('DELETE FROM actions WHERE class_id=? AND id<>?').bind(classId,action?.id||''),
  env.DB.prepare('DELETE FROM sessions WHERE member_id IN (SELECT id FROM members WHERE class_id=? AND id<>?)').bind(classId,id.user.id),
  env.DB.prepare('DELETE FROM members WHERE class_id=? AND id<>?').bind(classId,id.user.id),
 );
 if(classId===INITIAL_CLASS_ID){
  statements.push(env.DB.prepare('UPDATE classes SET name=? WHERE id=?').bind('材料科学与工程',classId));
  statements.push(env.DB.prepare('UPDATE members SET nickname=?,role=?,access_role=?,student_no=NULL WHERE id=? AND class_id=?').bind('罗文杰','admin','faculty',id.user.id,classId));
  statements.push(...await seedStatements(env,classId));
 }
 statements.push(env.DB.prepare('INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),classId,id.user.id,'class_reset',classId,now()));
 await env.DB.batch(statements);
 return {ok:true,seeded:classId===INITIAL_CLASS_ID};
}
