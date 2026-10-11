import type { Env, Identity } from './types';
import { now, uuid } from './auth';

/** Draft text stays private until the normal publish confirmation is completed. */
export async function rememberNoticeDraft(env: Env, id: Identity, content: string, sourceDate: string) {
  if (id.user.role !== 'admin') return;
  await env.DB.prepare('INSERT INTO notice_memories(id,class_id,member_id,content,source_date,created_at) VALUES(?,?,?,?,?,?)')
    .bind(uuid(), id.user.classId, id.user.id, content.slice(0, 12000), sourceDate, now()).run();
}

export async function searchNoticeMemory(env: Env, id: Identity, query: string) {
  const words = query.trim().toLowerCase().split(/[\s，。？?、]+/).filter(word => word.length >= 2).slice(0, 6);
  const rows = await env.DB.prepare('SELECT id,content,source_date AS sourceDate FROM notice_memories WHERE class_id=? AND member_id=? ORDER BY created_at DESC LIMIT 100')
    .bind(id.user.classId, id.user.id).all<{ id: string; content: string; sourceDate: string }>();
  return rows.results.filter(row => !words.length || words.some(word => row.content.toLowerCase().includes(word))).slice(0, 5);
}
