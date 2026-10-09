import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { admin, now, uuid } from './auth';
import type { Env, Identity } from './types';
import { getSchedule } from './schedule';
import { parseRoster } from './member-import';

const date = z.iso.date();
const dateTime = z.iso.datetime({ offset: true });
const examSchema = z.object({
  name: z.string().trim().min(1).max(120), category: z.string().trim().min(1).max(40),
  registrationDeadline: dateTime.nullable().default(null), examAt: dateTime,
  note: z.string().trim().max(500).default(''),
}).strict().refine(row => !row.registrationDeadline || Date.parse(row.registrationDeadline) <= Date.parse(row.examAt), '报名截止不能晚于考试时间');
const eventSchema = z.object({ eventDate: date, title: z.string().trim().min(1).max(120), note: z.string().trim().max(500).default('') }).strict();

export async function calendarData(env: Env, id: Identity) {
  const [semester, exams, events, schedule] = await Promise.all([
    env.DB.prepare('SELECT semester_start AS semesterStart FROM classes WHERE id=?').bind(id.user.classId).first<{ semesterStart: string | null }>(),
    env.DB.prepare('SELECT id,name,category,registration_deadline AS registrationDeadline,exam_at AS examAt,note FROM exams WHERE class_id=? ORDER BY exam_at,id').bind(id.user.classId).all(),
    env.DB.prepare('SELECT id,event_date AS eventDate,title,note FROM calendar_events WHERE class_id=? ORDER BY event_date,id').bind(id.user.classId).all(),
    getSchedule(env, id),
  ]);
  return { semesterStart: semester?.semesterStart ?? null, exams: exams.results, events: events.results, timetable: schedule.timetable };
}

export async function addExam(env: Env, id: Identity, input: unknown) {
  admin(id); const row = examSchema.parse(input), examId = uuid();
  await env.DB.prepare('INSERT INTO exams(id,class_id,name,category,registration_deadline,exam_at,note,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(examId,id.user.classId,row.name,row.category,row.registrationDeadline,row.examAt,row.note,now()).run();
  return { id: examId, ...row };
}

export async function addCalendarEvent(env: Env, id: Identity, input: unknown) {
  admin(id); const row = eventSchema.parse(input), eventId = uuid();
  await env.DB.prepare('INSERT INTO calendar_events(id,class_id,event_date,title,note,created_at) VALUES(?,?,?,?,?,?)')
    .bind(eventId,id.user.classId,row.eventDate,row.title,row.note,now()).run();
  return { id: eventId, ...row };
}

export async function setSemesterStart(env: Env, id: Identity, input: unknown) {
  admin(id); const { semesterStart } = z.object({ semesterStart: date.nullable() }).strict().parse(input);
  await env.DB.prepare('UPDATE classes SET semester_start=? WHERE id=?').bind(semesterStart,id.user.classId).run();
  return { semesterStart };
}

export async function importCalendar(env: Env, id: Identity, input: unknown) {
  admin(id);
  const body = z.object({ kind: z.enum(['exams','events']), csv: z.string().max(60000) }).strict().parse(input);
  const rows = parseRoster(body.csv).filter((row, index) => index > 0 || !/^(name|名称|eventDate|日期)$/i.test(row.cells[0]));
  if (rows.length > 500) throw new HTTPException(413, { message: '一次最多导入500行。' });
  const errors: Array<{line:number;reason:string}> = []; let imported = 0;
  for (const row of rows) {
    const cells = row.cells;
    try {
      if (body.kind === 'exams') await addExam(env,id,{name:cells[0],category:cells[1],registrationDeadline:cells[2] || null,examAt:cells[3],note:cells[4] || ''});
      else await addCalendarEvent(env,id,{eventDate:cells[0],title:cells[1],note:cells[2] || ''});
      imported++;
    } catch (error) { errors.push({ line:row.line,reason:error instanceof z.ZodError?'日期或字段格式无效':'保存失败，请重试' }); }
  }
  return { imported, failed:errors.length, errors };
}
