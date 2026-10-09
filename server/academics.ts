import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { admin, now, uuid } from './auth';
import { parseRoster } from './member-import';
import type { Env, Identity } from './types';

export const categories = ['required', 'elective', 'general'] as const;
export const modules = ['moral', 'intellectual', 'physical', 'aesthetic', 'labor'] as const;
const category = z.enum(categories);
const moduleName = z.enum(modules);
const semester = z.string().trim().min(1).max(40);
const score = z.number().finite().min(0).max(100);
const credits = z.number().finite().positive().max(30);
const memberIdSchema = z.string().uuid();
const courseSchema = z.object({ name: z.string().trim().min(1).max(120), semester, category, credits }).strict();

// Four-point conversion: <60=0, 60=1, 64=1.5, 68=2, 72=2.3,
// 75=2.7, 78=3, 82=3.3, 85=3.7, 90+=4.
export const gradePointScale = [
  { min: 90, point: 4 }, { min: 85, point: 3.7 }, { min: 82, point: 3.3 },
  { min: 78, point: 3 }, { min: 75, point: 2.7 }, { min: 72, point: 2.3 },
  { min: 68, point: 2 }, { min: 64, point: 1.5 }, { min: 60, point: 1 },
  { min: 0, point: 0 },
] as const;
export function gradePoint(value: number) { return gradePointScale.find(step => value >= step.min)!.point; }

async function member(env: Env, id: Identity, requested?: string) {
  const target = requested ? memberIdSchema.parse(requested) : id.user.id;
  if (target !== id.user.id) admin(id);
  const row = await env.DB.prepare('SELECT id,nickname FROM members WHERE id=? AND class_id=? AND deleted_at IS NULL').bind(target, id.user.classId).first<{ id: string; nickname: string }>();
  if (!row) throw new HTTPException(404, { message: '成员不存在。' });
  return row;
}

type CourseRow = { id: string; name: string; semester: string; category: typeof categories[number]; credits: number; score: number | null };
function summary(rows: CourseRow[]) {
  const graded = rows.filter(row => row.score !== null);
  const attempted = graded.reduce((sum, row) => sum + row.credits, 0);
  const earned = Object.fromEntries(categories.map(key => [key, graded.filter(row => row.category === key && row.score! >= 60).reduce((sum, row) => sum + row.credits, 0)])) as Record<typeof categories[number], number>;
  return { gpa: attempted ? Math.round(graded.reduce((sum, row) => sum + gradePoint(row.score!) * row.credits, 0) / attempted * 100) / 100 : null, attemptedCredits: attempted, completedCredits: earned, totalCompletedCredits: Object.values(earned).reduce((sum, value) => sum + value, 0) };
}

export async function getAcademics(env: Env, id: Identity, requestedMemberId?: string) {
  const target = await member(env, id, requestedMemberId);
  const [courseResult, comprehensiveResult, targetResult] = await Promise.all([
    env.DB.prepare('SELECT c.id,c.name,c.semester,c.category,c.credits,g.score FROM academic_courses c LEFT JOIN academic_grades g ON g.course_id=c.id AND g.member_id=? WHERE c.class_id=? ORDER BY c.semester DESC,c.name,c.id').bind(target.id, id.user.classId).all<CourseRow>(),
    env.DB.prepare('SELECT semester,module,score FROM academic_comprehensive WHERE class_id=? AND member_id=? ORDER BY semester DESC,module').bind(id.user.classId, target.id).all<{ semester: string; module: string; score: number }>(),
    env.DB.prepare('SELECT required,elective,general FROM academic_targets WHERE class_id=?').bind(id.user.classId).first<Record<typeof categories[number], number>>(),
  ]);
  const courses = courseResult.results;
  const semesters = [...new Set([...courses.map(row => row.semester), ...comprehensiveResult.results.map(row => row.semester)])].sort().reverse();
  const comprehensive = semesters.map(term => {
    const scores = Object.fromEntries(modules.map(key => [key, comprehensiveResult.results.find(row => row.semester === term && row.module === key)?.score ?? null]));
    const values = Object.values(scores).filter((value): value is number => value !== null);
    return { semester: term, scores, average: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null };
  });
  return {
    member: target, courses: courses.map(row => ({ ...row, gradePoint: row.score === null ? null : gradePoint(row.score) })),
    targets: targetResult ?? { required: 0, elective: 0, general: 0 },
    summary: { currentSemester: semesters[0] ?? null, current: summary(courses.filter(row => row.semester === semesters[0])), cumulative: summary(courses), semesters: semesters.map(term => ({ semester: term, ...summary(courses.filter(row => row.semester === term)) })) },
    comprehensive, gradePointScale, comprehensiveModules: modules,
  };
}

export async function setAcademicTargets(env: Env, id: Identity, input: unknown) {
  admin(id);
  const data = z.object({ required: z.number().finite().min(0).max(1000), elective: z.number().finite().min(0).max(1000), general: z.number().finite().min(0).max(1000) }).strict().parse(input);
  await env.DB.prepare('INSERT INTO academic_targets(class_id,required,elective,general) VALUES(?,?,?,?) ON CONFLICT(class_id) DO UPDATE SET required=excluded.required,elective=excluded.elective,general=excluded.general').bind(id.user.classId, data.required, data.elective, data.general).run();
  return data;
}

export async function createAcademicCourse(env: Env, id: Identity, input: unknown) {
  admin(id);
  const data = courseSchema.parse(input), courseId = uuid();
  const result = await env.DB.prepare('INSERT INTO academic_courses(id,class_id,name,semester,category,credits) VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,semester,name) DO NOTHING').bind(courseId, id.user.classId, data.name, data.semester, data.category, data.credits).run();
  if (!result.meta.changes) throw new HTTPException(409, { message: '该学期已有同名课程。' });
  return { id: courseId, ...data };
}

export async function updateAcademicCourse(env: Env, id: Identity, courseId: string, input: unknown) {
  admin(id);
  const data = courseSchema.parse(input);
  const result = await env.DB.prepare('UPDATE academic_courses SET name=?,semester=?,category=?,credits=? WHERE id=? AND class_id=?').bind(data.name, data.semester, data.category, data.credits, courseId, id.user.classId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: '课程不存在。' });
  return { id: courseId, ...data };
}

export async function deleteAcademicCourse(env: Env, id: Identity, courseId: string) {
  admin(id);
  const result = await env.DB.prepare('DELETE FROM academic_courses WHERE id=? AND class_id=?').bind(courseId, id.user.classId).run();
  if (!result.meta.changes) throw new HTTPException(404, { message: '课程不存在。' });
  return { ok: true };
}

export async function setAcademicGrade(env: Env, id: Identity, input: unknown) {
  admin(id);
  const data = z.object({ memberId: memberIdSchema, courseId: z.string().uuid(), score: score.nullable() }).strict().parse(input);
  await member(env, id, data.memberId);
  const course = await env.DB.prepare('SELECT id FROM academic_courses WHERE id=? AND class_id=?').bind(data.courseId, id.user.classId).first();
  if (!course) throw new HTTPException(404, { message: '课程不存在。' });
  if (data.score === null) await env.DB.prepare('DELETE FROM academic_grades WHERE course_id=? AND member_id=?').bind(data.courseId, data.memberId).run();
  else await env.DB.prepare('INSERT INTO academic_grades(course_id,member_id,score,updated_at) VALUES(?,?,?,?) ON CONFLICT(course_id,member_id) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at').bind(data.courseId, data.memberId, data.score, now()).run();
  return { ok: true };
}

export async function setAcademicComprehensive(env: Env, id: Identity, input: unknown) {
  admin(id);
  const data = z.object({ memberId: memberIdSchema, semester, module: moduleName, score: score.nullable() }).strict().parse(input);
  await member(env, id, data.memberId);
  if (data.score === null) await env.DB.prepare('DELETE FROM academic_comprehensive WHERE class_id=? AND member_id=? AND semester=? AND module=?').bind(id.user.classId, data.memberId, data.semester, data.module).run();
  else await env.DB.prepare('INSERT INTO academic_comprehensive(class_id,member_id,semester,module,score,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,member_id,semester,module) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at').bind(id.user.classId, data.memberId, data.semester, data.module, data.score, now()).run();
  return { ok: true };
}

export async function importAcademicGrades(env: Env, id: Identity, input: unknown) {
  admin(id);
  const data = z.object({ memberId: memberIdSchema, semester, category, text: z.string().trim().min(1).max(60000) }).strict().parse(input);
  await member(env, id, data.memberId);
  const rows = parseRoster(data.text);
  if (!rows.length || rows.length > 501) throw new HTTPException(400, { message: '请提供不超过 500 行成绩。' });
  if (/^(course|课程)$/i.test(rows[0].cells[0])) {
    const header = rows.shift()!.cells.map(cell => ({ course: 'course', '课程': 'course', credits: 'credits', '学分': 'credits', score: 'score', '成绩': 'score' })[cell]);
    if (header.join(',') !== 'course,credits,score') throw new HTTPException(400, { message: '表头须为 course,credits,score（或课程,学分,成绩）。' });
  }
  if (rows.length > 500) throw new HTTPException(400, { message: '每次最多导入 500 行成绩。' });
  const existing = (await env.DB.prepare('SELECT id,name,credits,category FROM academic_courses WHERE class_id=? AND semester=?').bind(id.user.classId, data.semester).all<{ id: string; name: string; credits: number; category: string }>()).results;
  const byName = new Map(existing.map(row => [row.name, row]));
  const errors: { line: number; reason: string }[] = [], statements: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const parsed = z.object({ name: z.string().trim().min(1).max(120), credits, score }).safeParse({ name: row.cells[0], credits: Number(row.cells[1]), score: Number(row.cells[2]) });
    if (row.cells.length !== 3 || row.cells[1] === '' || row.cells[2] === '' || !parsed.success) { errors.push({ line: row.line, reason: '课程、学分或成绩格式无效。' }); continue; }
    const value = parsed.data, found = byName.get(value.name);
    if (seen.has(value.name)) { errors.push({ line: row.line, reason: '本次导入中课程重复。' }); continue; }
    if (found && (found.credits !== value.credits || found.category !== data.category)) { errors.push({ line: row.line, reason: '同名课程的学分或类别与已有记录不一致。' }); continue; }
    seen.add(value.name);
    const courseId = found?.id ?? uuid();
    if (!found) {
      byName.set(value.name, { id: courseId, name: value.name, credits: value.credits, category: data.category });
      statements.push(env.DB.prepare('INSERT INTO academic_courses(id,class_id,name,semester,category,credits) VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,semester,name) DO NOTHING').bind(courseId, id.user.classId, value.name, data.semester, data.category, value.credits));
    }
    statements.push(env.DB.prepare('INSERT INTO academic_grades(course_id,member_id,score,updated_at) SELECT id,?,?,? FROM academic_courses WHERE class_id=? AND semester=? AND name=? AND category=? AND credits=? ON CONFLICT(course_id,member_id) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at').bind(data.memberId, value.score, now(), id.user.classId, data.semester, value.name, data.category, value.credits));
  }
  if (statements.length) await env.DB.batch(statements);
  return { total: rows.length, imported: seen.size, failed: errors.length, errors };
}
