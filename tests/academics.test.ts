import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { Env, Identity } from '../server/types';
import { createAcademicCourse, getAcademics, gradePoint, importAcademicGrades, setAcademicComprehensive, setAcademicGrade, setAcademicTargets } from '../server/academics';

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}
  bind(...args: unknown[]) { return new Statement(this.db, this.sql, args); }
  async first() { return this.db.prepare(this.sql).get(...this.args as never[]) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args as never[]) }; }
  async run() { const result = this.db.prepare(this.sql).run(...this.args as never[]); return { meta: { changes: Number(result.changes) } }; }
}
class TestD1 {
  db = new DatabaseSync(':memory:');
  constructor() {
    for (const file of ['0001_initial.sql', '0002_members.sql', '0003_join_policy.sql', '0004_member_removal.sql', '0005_timetable_duty.sql', '0006_notice_categories.sql', '0007_academics.sql'])
      this.db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
    for (const classId of ['a', 'b']) this.db.prepare('INSERT INTO classes(id,name,invite_code,created_at) VALUES(?,?,?,?)').run(classId, classId, classId, 'now');
    for (const [id, classId, role] of [[adminId, 'a', 'admin'], [studentId, 'a', 'student'], [otherId, 'b', 'student']])
      this.db.prepare('INSERT INTO members(id,class_id,nickname,role,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').run(id, classId, id, role, id, 'now');
  }
  prepare(sql: string) { return new Statement(this.db, sql); }
  async batch(statements: Statement[]) {
    this.db.exec('BEGIN');
    try { const result = await Promise.all(statements.map(statement => statement.run())); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
let db: TestD1, env: Env;
const adminId = '00000000-0000-4000-8000-000000000001', studentId = '00000000-0000-4000-8000-000000000002', otherId = '00000000-0000-4000-8000-000000000003';
const identity = (memberId: string, role: 'admin' | 'student', classId = 'a'): Identity => ({ user: { id: memberId, classId, nickname: memberId, role }, classroom: { id: classId, name: classId, isDemo: false } });
const owner = identity(adminId, 'admin'), student = identity(studentId, 'student');
beforeEach(() => { db = new TestD1(); env = { DB: db as unknown as D1Database }; });
afterEach(() => db.db.close());

describe('academic records', () => {
  it('calculates weighted GPA and passing credits per category and semester', async () => {
    await setAcademicTargets(env, owner, { required: 8, elective: 3, general: 2 });
    const math = await createAcademicCourse(env, owner, { name: '数学', semester: '2026-1', category: 'required', credits: 4 });
    const english = await createAcademicCourse(env, owner, { name: '英语', semester: '2026-1', category: 'elective', credits: 2 });
    const history = await createAcademicCourse(env, owner, { name: '历史', semester: '2026-2', category: 'general', credits: 2 });
    for (const [course, result] of [[math, 90], [english, 59], [history, 85]] as const)
      await setAcademicGrade(env, owner, { memberId: student.user.id, courseId: course.id, score: result });
    const view = await getAcademics(env, student);
    expect(view.summary.cumulative).toMatchObject({ gpa: 2.93, attemptedCredits: 8, totalCompletedCredits: 6, completedCredits: { required: 4, elective: 0, general: 2 } });
    expect(view.summary.current).toMatchObject({ gpa: 3.7, attemptedCredits: 2 });
    expect(view.targets).toEqual({ required: 8, elective: 3, general: 2 });
    expect([gradePoint(59), gradePoint(60), gradePoint(90)]).toEqual([0, 1, 4]);
  });

  it('keeps grades private and rejects foreign-class members and courses', async () => {
    const course = await createAcademicCourse(env, owner, { name: '数学', semester: '2026-1', category: 'required', credits: 4 });
    await setAcademicGrade(env, owner, { memberId: owner.user.id, courseId: course.id, score: 92 });
    expect((await getAcademics(env, student)).courses[0].score).toBeNull();
    await expect(getAcademics(env, student, owner.user.id)).rejects.toMatchObject({ status: 403 });
    await expect(getAcademics(env, owner, otherId)).rejects.toMatchObject({ status: 404 });
    await expect(setAcademicGrade(env, owner, { memberId: otherId, courseId: course.id, score: 90 })).rejects.toMatchObject({ status: 404 });
    await expect(setAcademicTargets(env, student, { required: 1, elective: 1, general: 1 })).rejects.toMatchObject({ status: 403 });
  });

  it('imports quoted CSV, reports invalid rows and preserves existing course metadata', async () => {
    const memberId = student.user.id;
    const result = await importAcademicGrades(env, owner, { memberId, semester: '2026-1', category: 'required', text: 'course,credits,score\n"大学,数学",4,90\n英语,2,61\n坏数据,0,95' });
    expect(result).toMatchObject({ imported: 2, failed: 1 });
    expect((await getAcademics(env, student)).summary.cumulative).toMatchObject({ gpa: 3, totalCompletedCredits: 6 });
    const conflict = await importAcademicGrades(env, owner, { memberId, semester: '2026-1', category: 'elective', text: 'course,credits,score\n英语,2,99' });
    expect(conflict).toMatchObject({ imported: 0, failed: 1 });
    expect((await getAcademics(env, student)).courses.find(course => course.name === '英语')?.score).toBe(61);
  });

  it('stores all five comprehensive modules without leaking another member scores', async () => {
    for (const module of ['moral', 'intellectual', 'physical', 'aesthetic', 'labor'])
      await setAcademicComprehensive(env, owner, { memberId: student.user.id, semester: '2026-1', module, score: 80 });
    expect((await getAcademics(env, student)).comprehensive[0]).toMatchObject({ average: 80, scores: { moral: 80, intellectual: 80, physical: 80, aesthetic: 80, labor: 80 } });
    expect((await getAcademics(env, owner)).comprehensive).toEqual([]);
    expect(db.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
