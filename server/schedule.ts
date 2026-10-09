import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { admin, uuid } from './auth';
import type { Env, Identity } from './types';
import { adminTasks, progress, tasks } from './business';

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const weekday = z.enum(weekdays);
const timetableRow = z.object({ day: weekday, time: z.string().trim().min(1).max(40), course: z.string().trim().min(1).max(120), room: z.string().trim().max(120).default('') }).strict();
const dutyRow = z.object({ day: weekday, name: z.string().trim().min(1).max(80) }).strict();
const payloadSchema = z.object({ timetable: z.array(timetableRow).max(500), duty: z.array(dutyRow).max(500) }).strict();

export async function getSchedule(env: Env, id: Identity) {
  const [timetable, duty] = await Promise.all([
    env.DB.prepare('SELECT weekday AS day,period AS time,course,room FROM timetable_entries WHERE class_id=? ORDER BY position,id').bind(id.user.classId).all<{ day: string; time: string; course: string; room: string }>(),
    env.DB.prepare('SELECT d.weekday AS day,m.nickname AS name FROM duty_entries d JOIN members m ON m.id=d.member_id WHERE d.class_id=? AND m.deleted_at IS NULL ORDER BY d.position,d.id').bind(id.user.classId).all<{ day: string; name: string }>(),
  ]);
  return { timetable: timetable.results, duty: duty.results.map(row => ({ ...row, member: row.name })) };
}

export async function replaceSchedule(env: Env, id: Identity, input: unknown) {
  admin(id);
  const data = payloadSchema.parse(input);
  if (new Set(data.duty.map(row => `${row.day}\0${row.name}`)).size !== data.duty.length) throw new HTTPException(400, { message: '同一成员在同一天不能重复排班。' });
  const names = [...new Set(data.duty.map(row => row.name))];
  const memberIds = new Map<string, string>();
  if (names.length) {
    const rows = await env.DB.prepare(`SELECT id,nickname FROM members WHERE class_id=? AND deleted_at IS NULL AND nickname IN (${names.map(() => '?').join(',')})`).bind(id.user.classId, ...names).all<{ id: string; nickname: string }>();
    for (const row of rows.results) memberIds.set(row.nickname, row.id);
  }
  if (names.some(name => !memberIds.has(name))) throw new HTTPException(400, { message: '值日成员不存在或不属于当前班级。' });
  const statements = [
    env.DB.prepare('DELETE FROM timetable_entries WHERE class_id=?').bind(id.user.classId),
    env.DB.prepare('DELETE FROM duty_entries WHERE class_id=?').bind(id.user.classId),
    ...data.timetable.map((row, position) => env.DB.prepare('INSERT INTO timetable_entries(id,class_id,weekday,period,course,room,position) VALUES(?,?,?,?,?,?,?)').bind(uuid(), id.user.classId, row.day, row.time, row.course, row.room, position)),
    ...data.duty.map((row, position) => env.DB.prepare('INSERT INTO duty_entries(id,class_id,weekday,member_id,position) VALUES(?,?,?,?,?)').bind(uuid(), id.user.classId, row.day, memberIds.get(row.name)!, position)),
  ];
  await env.DB.batch(statements);
  return getSchedule(env, id);
}

function csvRows(input: string) {
  const lines = input.replace(/^\uFEFF/, '').replace(/\\n/g, '\n').replace(/\\r/g, '').split(/\r?\n/);
  return lines.map(line => {
    const cells: string[] = []; let value = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(value.trim()); value = ''; }
      else value += char;
    }
    cells.push(value.trim());
    return cells;
  });
}

export async function importSchedule(env: Env, id: Identity, input: unknown) {
  admin(id);
  const body = z.object({ timetable: z.string().max(60000).default(''), duty: z.string().max(60000).default('') }).strict().parse(input);
  const members = await env.DB.prepare('SELECT nickname FROM members WHERE class_id=? AND deleted_at IS NULL').bind(id.user.classId).all<{ nickname: string }>();
  const existing = await getSchedule(env, id);
  const memberNames = new Set(members.results.map(row => row.nickname));
  const parse = (source: string, kind: 'timetable' | 'duty') => {
    const lines = csvRows(source), rows: unknown[] = [], errors: Array<{ line: number; reason: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const cells = lines[i]; if (!cells.some(Boolean)) continue;
      if (i === 0 && /^(day|weekday|星期|日期)$/i.test(cells[0])) continue;
      const candidate = kind === 'timetable'
        ? { day: cells[0], time: cells[1], course: cells[2], room: cells[3] || '' }
        : { day: cells[0], name: cells[1] };
      const parsed = (kind === 'timetable' ? timetableRow : dutyRow).safeParse(candidate);
      if (!parsed.success) errors.push({ line: i + 1, reason: '字段格式无效。' });
      else if (kind === 'duty' && !memberNames.has((parsed.data as z.infer<typeof dutyRow>).name)) errors.push({ line: i + 1, reason: '成员不存在或不属于当前班级。' });
      else if (kind === 'duty' && (existing.duty.some(row => row.day === (parsed.data as z.infer<typeof dutyRow>).day && row.name === (parsed.data as z.infer<typeof dutyRow>).name) || rows.some(row => (row as z.infer<typeof dutyRow>).day === (parsed.data as z.infer<typeof dutyRow>).day && (row as z.infer<typeof dutyRow>).name === (parsed.data as z.infer<typeof dutyRow>).name))) errors.push({ line: i + 1, reason: '该成员已在同一天排班。' });
      else rows.push(parsed.data);
    }
    return { rows, errors };
  };
  const t = parse(body.timetable, 'timetable'), d = parse(body.duty, 'duty');
  const combined = payloadSchema.parse({ timetable: [...existing.timetable, ...t.rows], duty: [...existing.duty.map(row => ({ day: row.day, name: row.name })), ...d.rows] });
  const saved = await replaceSchedule(env, id, combined);
  return { timetable: { imported: t.rows.length, failed: t.errors.length, errors: t.errors }, duty: { imported: d.rows.length, failed: d.errors.length, errors: d.errors }, saved };
}

export async function loadBanshuContext(env: Env, id: Identity) {
  const schedule = await getSchedule(env, id);
  const [classroom, people, recent, ownTasks] = await Promise.all([
    env.DB.prepare('SELECT name FROM classes WHERE id=?').bind(id.user.classId).first<{ name: string }>(),
    env.DB.prepare('SELECT nickname,role FROM members WHERE class_id=? AND deleted_at IS NULL ORDER BY created_at,id').bind(id.user.classId).all<{ nickname: string; role: string }>(),
    env.DB.prepare("SELECT title,content,source_date AS date FROM notices WHERE class_id=? AND status='published' AND source_date>=date('now','-7 days') ORDER BY source_date DESC,created_at DESC LIMIT 50").bind(id.user.classId).all<{ title: string; content: string; date: string }>(),
    tasks(env, id),
  ]);
  const adminProgress = id.user.role === 'admin' ? await Promise.all((await adminTasks(env, id)).map((task: any) => progress(env, id, task.id))) : [];
  const data = {
    ...schedule,
    duty: schedule.duty.map(row => ({ day: row.day, member: row.name })),
    members: people.results.map(person => ({ name: person.nickname, role: person.role })),
    notices: recent.results,
    className: classroom?.name || '',
    role: id.user.role,
    ownTasks: ownTasks.map(task => ({ title: task.title, description: task.description, dueAt: task.dueAt, status: task.status })),
    adminProgress,
  };
  return { className: classroom?.name || '', role: id.user.role, data, ownTasks: data.ownTasks };
}
