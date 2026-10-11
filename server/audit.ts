import { z } from 'zod';
import { faculty, now, uuid } from './auth';
import type { Env, Identity } from './types';

export async function recordAudit(env: Env, classId: string, memberId: string, action: string, targetId: string) {
  await env.DB.prepare('INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)')
    .bind(uuid(), classId, memberId, action, targetId, now()).run();
}

const actionNames: Record<string,string> = {
  class_create:'创建班级', login:'登录班级空间', account_activate:'激活成员账号', member_import:'导入成员',
  publish_notice:'发布通知', edit_notice:'修改通知', withdraw_notice:'撤回通知',
  task_status:'更新班级任务状态', personal_tasks_create:'创建个人待办', personal_task_create:'创建个人待办',
  create_vote:'发起投票', member_remove:'移出成员', password_reset:'重置成员密码',
  faculty_transfer:'移交辅导员身份', class_reset:'清空并重建班级', class_name:'修改班级名称',
  invite_rotate:'重置班级邀请码', schedule_add:'录入课程', duty_add:'录入值日',
  exam_add:'录入考试', calendar_event_add:'录入校历', student_import:'导入学生', grade_set:'录入成绩',
};
const recordKinds: Record<string,string> = {assignment:'作业',fee:'班费',activity:'活动',shift:'值班'};
function describeAction(action:string){
  if(actionNames[action])return actionNames[action];
  if(action.startsWith('member_role:'))return action.endsWith(':cadre')?'任命班干部':'调整成员角色';
  if(action.startsWith('personal_task_status:'))return action.endsWith(':completed')?'完成个人待办':'撤销个人待办完成';
  if(action.startsWith('class_record_create:'))return `录入${recordKinds[action.split(':')[1]]||'班级'}记录`;
  return '班级事务操作';
}

export async function listAudit(env:Env,id:Identity,pageInput:string|undefined){
  faculty(id);
  const page=z.coerce.number().int().min(1).max(10000).default(1).parse(pageInput);
  const pageSize=20,offset=(page-1)*pageSize;
  const [total,rows]=await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM audit_log WHERE class_id=?').bind(id.user.classId).first<{total:number}>(),
    env.DB.prepare(`SELECT a.id,a.created_at AS createdAt,a.action,
      COALESCE(m.nickname,'已移出成员') AS actorName,
      CASE m.access_role WHEN 'faculty' THEN '辅导员' WHEN 'cadre' THEN '班干部' WHEN 'student' THEN '学生' ELSE '历史成员' END AS actorRole
      FROM audit_log a LEFT JOIN members m ON m.id=a.member_id AND m.class_id=a.class_id
      WHERE a.class_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`)
      .bind(id.user.classId,pageSize,offset).all<{id:string;createdAt:string;action:string;actorName:string;actorRole:string}>(),
  ]);
  return {page,pageSize,total:total?.total??0,entries:rows.results.map(({action,...row})=>({...row,description:describeAction(action)}))};
}
