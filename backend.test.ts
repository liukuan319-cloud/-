import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import app from '../server/index'
import { calendar, draftSchema } from '../server/validation'
import type { Env } from '../server/types'

/** D1-compatible adapter over actual SQLite; batch is an atomic transaction. */
class Statement {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}
  bind(...args: unknown[]) { return new Statement(this.db, this.sql, args) }
  async first(column?: string) {
    const row = this.db.prepare(this.sql).get(...this.args as never[]) as Record<string, unknown> | undefined
    return row ? column ? row[column] : row : null
  }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args as never[]), success: true, meta: {} } }
  execute() { const result = this.db.prepare(this.sql).run(...this.args as never[]); return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } }
  async run() { return this.execute() }
}
class SqliteD1 {
  db = new DatabaseSync(':memory:')
  constructor() { this.db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')) }
  prepare(sql: string) { return new Statement(this.db, sql) }
  async batch(statements: Statement[]) { this.db.exec('BEGIN'); try { const results = statements.map(s => s.execute()); this.db.exec('COMMIT'); return results } catch (e) { this.db.exec('ROLLBACK'); throw e } }
}
let db: SqliteD1
let env: Env
beforeEach(() => { db = new SqliteD1(); env = { DB: db as unknown as D1Database } })
afterEach(() => { vi.unstubAllGlobals(); db.db.close() })

async function request(path: string, method = 'GET', body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return app.request(`https://class.test/api${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env)
}
async function signup(name = '测试班级', nickname = '班干部') {
  const response = await request('/classes', 'POST', { name, nickname })
  expect(response.status).toBe(200)
  return { ...(await response.json()) as any, cookie: response.headers.get('set-cookie')!.split(';')[0], response }
}
async function join(owner: any, nickname = '同学甲') {
  const response = await request('/join', 'POST', { inviteCode: owner.classroom.inviteCode, nickname })
  expect(response.status).toBe(200)
  return { ...(await response.json()) as any, cookie: response.headers.get('set-cookie')!.split(';')[0] }
}
const draft = (overrides: Record<string, unknown> = {}) => ({ title: '运动会报名', content: '请于 2026 年 10 月 12 日 18:00 前提交报名表。', sourceDate: '2026-10-08', tasks: [{ title: '提交报名表', description: '检查报名项目后交给班干部。', dueAt: '2026-10-12T18:00:00+08:00', audience: 'all', memberIds: [] }], ...overrides })

describe('same-origin Banshu API contract', () => {
  it('returns reply JSON after a model tool round without modifying class data', async () => {
    env.API_KEY = 'server-only-test-key'
    const owner = await signup()
    let call = 0
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: call++ === 0
      ? { content: null, tool_calls: [{ id: 'duty', type: 'function', function: { name: 'get_duty', arguments: '{"day":"周五"}' } }] }
      : { content: '明天周五由张三值日。' } }] })))
    const response = await request('/chat', 'POST', { message: '明天谁值日？', history: [], data: { timetable: [], duty: [{ day: '周五', member: '张三' }], members: [], notices: [] } }, owner.cookie)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reply: '明天周五由张三值日。' })
    expect(db.db.prepare('SELECT count(*) AS count FROM actions').get()!.count).toBe(0)
    expect(db.db.prepare('SELECT count(*) AS count FROM messages').get()!.count).toBe(0)
    expect((await request('/chat', 'POST', { message: '明天谁值日？', history: [], data: {} })).status).toBe(401)
  })
})
async function prepare(owner: any, value = draft()) { const response = await request('/drafts', 'POST', value, owner.cookie); expect(response.status).toBe(200); return (await response.json() as any).action }
async function publish(owner: any, value = draft()) { const action = await prepare(owner, value); const response = await request(`/actions/${action.id}/confirm`, 'POST', {}, owner.cookie); expect(response.status).toBe(200); return (await response.json() as any).result }
async function getTasks(user: any) { return (await (await request('/tasks', 'GET', undefined, user.cookie)).json() as any).tasks }
async function taskAction(user: any, task: any, status = 'completed') { const response = await request('/actions', 'POST', { type: 'task_status', taskId: task.id, version: task.version, status }, user.cookie); expect(response.status).toBe(200); return (await response.json() as any).action }

describe('identity and authentication', () => {
  it('requires identity for every class read', async () => { expect((await request('/tasks')).status).toBe(401); expect((await request('/notices')).status).toBe(401) })
  it('creates an administrator with a secure cookie and only stores credential hashes', async () => {
    const owner = await signup()
    expect(owner.user.role).toBe('admin'); expect(owner.mode).toBe('unconfigured')
    expect(owner.response.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(owner.response.headers.get('set-cookie')).toMatch(/Secure/)
    expect(owner.response.headers.get('set-cookie')).toMatch(/SameSite=Strict/)
    expect(db.db.prepare('SELECT recovery_hash FROM members').get()!.recovery_hash).not.toBe(owner.recoveryCode)
    const read = await (await request('/session', 'GET', undefined, owner.cookie)).json() as any
    expect(read.user.id).toBe(owner.user.id); expect(read.recoveryCode).toBeUndefined()
  })
  it('joins as a student and does not disclose the class invitation', async () => { const owner = await signup(); const student = await join(owner); expect(student.user.role).toBe('student'); expect(student.classroom.inviteCode).toBeUndefined() })
  it('rejects a duplicate nickname instead of entering another identity', async () => { const owner = await signup(); await join(owner); expect((await request('/join', 'POST', { inviteCode: owner.classroom.inviteCode, nickname: '同学甲' })).status).toBe(409) })
  it('recovers the same identity and rejects an invalid recovery code', async () => { const owner = await signup(); const recovered = await request('/session/recover', 'POST', { recoveryCode: owner.recoveryCode }); expect(recovered.status).toBe(200); expect((await recovered.json() as any).user.id).toBe(owner.user.id); expect((await request('/session/recover', 'POST', { recoveryCode: 'x'.repeat(64) })).status).toBe(401) })
  it('revokes the current session on logout', async () => { const owner = await signup(); expect((await request('/session', 'DELETE', undefined, owner.cookie)).status).toBe(200); expect((await request('/session', 'GET', undefined, owner.cookie)).status).toBe(401) })
  it('rotates invitation codes without removing existing members', async () => { const owner = await signup(); const student = await join(owner); const response = await request('/invite/rotate', 'POST', {}, owner.cookie); expect(response.status).toBe(200); expect((await request('/join', 'POST', { inviteCode: owner.classroom.inviteCode, nickname: '后来同学' })).status).toBe(404); expect((await request('/session', 'GET', undefined, student.cookie)).status).toBe(200) })
  it('blocks cross-origin mutations and invalid JSON', async () => { expect((await request('/classes', 'POST', { name: 'X', nickname: 'Y' }, undefined, { Origin: 'https://evil.example' })).status).toBe(403); const response = await app.request('https://class.test/api/classes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }, env); expect(response.status).toBe(400) })
  it('keeps each demo class separate from other demo and real classes', async () => { const one = await (await request('/demo', 'POST', { role: 'admin' })).json() as any; const two = await (await request('/demo', 'POST', { role: 'student' })).json() as any; const real = await signup(); expect(one.mode).toBe('demo'); expect(one.classroom.id).not.toBe(two.classroom.id); expect(one.classroom.id).not.toBe(real.classroom.id) })
})

describe('business permissions and confirmations', () => {
  it('preparing a draft never publishes; concurrent confirmation publishes exactly once', async () => {
    const owner = await signup(); const action = await prepare(owner)
    expect(db.db.prepare('SELECT count(*) AS count FROM notices').get()!.count).toBe(0)
    const responses = await Promise.all([request(`/actions/${action.id}/confirm`, 'POST', {}, owner.cookie), request(`/actions/${action.id}/confirm`, 'POST', {}, owner.cookie)])
    expect(responses.map(r => r.status)).toEqual([200, 200])
    const values = await Promise.all(responses.map(r => r.json()))
    expect(values[0]).toEqual(values[1]); expect(db.db.prepare('SELECT count(*) AS count FROM notices').get()!.count).toBe(1)
    expect(db.db.prepare('SELECT count(*) AS count FROM audit_log').get()!.count).toBe(1)
  })
  it('allows editing a prepared draft during explicit confirmation', async () => { const owner = await signup(); const action = await prepare(owner); const response = await request(`/actions/${action.id}/confirm`, 'POST', { draft: draft({ title: '已核实的运动会报名' }) }, owner.cookie); expect(response.status).toBe(200); expect(db.db.prepare('SELECT title FROM notices').get()!.title).toBe('已核实的运动会报名') })
  it('does not allow students to publish, list members, inspect progress, or rotate invites', async () => { const owner = await signup(); const student = await join(owner); await publish(owner); const task = (await getTasks(student))[0]; expect((await request('/drafts', 'POST', draft(), student.cookie)).status).toBe(403); expect((await request('/members', 'GET', undefined, student.cookie)).status).toBe(403); expect((await request(`/tasks/${task.id}/progress`, 'GET', undefined, student.cookie)).status).toBe(403); expect((await request('/invite/rotate', 'POST', {}, student.cookie)).status).toBe(403); expect((await request('/admin/tasks', 'GET', undefined, student.cookie)).status).toBe(403) })
  it('hides another class notices and tasks from an administrator', async () => { const owner = await signup(); const other = await signup('另一个班'); const pub = await publish(owner); const task = (await getTasks(owner))[0]; expect(await getTasks(other)).toHaveLength(0); expect((await request(`/notices/${pub.noticeId}`, 'GET', undefined, other.cookie)).status).toBe(404); expect((await request(`/tasks/${task.id}/progress`, 'GET', undefined, other.cookie)).status).toBe(404); expect((await request(`/notices/${pub.noticeId}`, 'PATCH', { version: 1, title: '篡改' }, other.cookie)).status).toBe(404) })
  it('rejects foreign-class recipients and selected tasks without members', async () => { const owner = await signup(); const other = await signup('其他班'); const task = draft().tasks[0]; expect((await request('/drafts', 'POST', draft({ tasks: [{ ...task, audience: 'selected', memberIds: [other.user.id] }] }), owner.cookie)).status).toBe(400); expect((await request('/drafts', 'POST', draft({ tasks: [{ ...task, audience: 'selected', memberIds: [] }] }), owner.cookie)).status).toBe(400) })
  it('shows selected-member tasks only to intended members while the admin can view progress', async () => { const owner = await signup(); const one = await join(owner); const two = await join(owner, '同学乙'); await publish(owner, draft({ tasks: [{ ...draft().tasks[0], audience: 'selected', memberIds: [one.user.id] }] })); expect(await getTasks(one)).toHaveLength(1); expect(await getTasks(two)).toHaveLength(0); expect(await getTasks(owner)).toHaveLength(0); const all = await (await request('/admin/tasks', 'GET', undefined, owner.cookie)).json() as any; expect(all.tasks).toHaveLength(1); const progress = await (await request(`/tasks/${all.tasks[0].id}/progress`, 'GET', undefined, owner.cookie)).json() as any; expect(progress.total).toBe(1); expect(progress.members[0].id).toBe(one.user.id) })
  it('includes later joiners in all-class tasks but not selected-member tasks', async () => { const owner = await signup(); await publish(owner); await publish(owner, draft({ title: '仅班干部', tasks: [{ ...draft().tasks[0], audience: 'selected', memberIds: [owner.user.id] }] })); const student = await join(owner); expect(await getTasks(student)).toHaveLength(1) })
  it('requires confirmation and updates only the current member, idempotently', async () => { const owner = await signup(); const student = await join(owner); await publish(owner); const task = (await getTasks(student))[0]; const action = await taskAction(student, task); expect((await getTasks(student))[0].status).toBe('pending'); expect((await request(`/actions/${action.id}/confirm`, 'POST', {}, owner.cookie)).status).toBe(404); await request(`/actions/${action.id}/confirm`, 'POST', {}, student.cookie); await request(`/actions/${action.id}/confirm`, 'POST', {}, student.cookie); expect((await getTasks(student))[0]).toMatchObject({ status: 'completed', version: 1 }); expect((await getTasks(owner))[0].status).toBe('pending') })
  it('rejects one of two conflicting prepared updates on the same task version', async () => { const owner = await signup(); await publish(owner); const task = (await getTasks(owner))[0]; const a = await taskAction(owner, task); const b = await taskAction(owner, task, 'pending'); const results = await Promise.all([request(`/actions/${a.id}/confirm`, 'POST', {}, owner.cookie), request(`/actions/${b.id}/confirm`, 'POST', {}, owner.cookie)]); expect(results.map(r => r.status).sort()).toEqual([200, 409]); expect((await getTasks(owner))[0].version).toBe(1) })
  it('rejects expired actions and leaves the database unchanged', async () => { const owner = await signup(); const action = await prepare(owner); db.db.prepare('UPDATE actions SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', action.id); expect((await request(`/actions/${action.id}/confirm`, 'POST', {}, owner.cookie)).status).toBe(409); expect(db.db.prepare('SELECT count(*) AS count FROM notices').get()!.count).toBe(0) })
  it('saves notice versions and rejects stale edits', async () => { const owner = await signup(); const pub = await publish(owner); expect((await request(`/notices/${pub.noticeId}`, 'PATCH', { title: '新标题', version: 1 }, owner.cookie)).status).toBe(200); expect((await request(`/notices/${pub.noticeId}`, 'PATCH', { title: '过期编辑', version: 1 }, owner.cookie)).status).toBe(409); expect(db.db.prepare('SELECT count(*) AS count FROM notice_versions').get()!.count).toBe(2) })
  it('withdraws associated tasks and invalidates pending status changes', async () => { const owner = await signup(); const student = await join(owner); const pub = await publish(owner); const action = await taskAction(student, (await getTasks(student))[0]); expect((await request(`/notices/${pub.noticeId}`, 'DELETE', { version: 1 }, owner.cookie)).status).toBe(200); expect(await getTasks(student)).toHaveLength(0); expect((await request(`/actions/${action.id}/confirm`, 'POST', {}, student.cookie)).status).toBe(409); expect((await request(`/notices/${pub.noticeId}`, 'GET', undefined, student.cookie)).status).toBe(404) })
  it('keeps histories and clear operations member-specific', async () => { const owner = await signup(); const student = await join(owner); for (const user of [owner, student]) db.db.prepare('INSERT INTO messages(id,member_id,role,content,cards,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), user.user.id, 'user', user.user.nickname, '[]', new Date().toISOString()); const read = await (await request('/chat', 'GET', undefined, student.cookie)).json() as any; expect(read.messages).toHaveLength(1); expect(read.messages[0].content).toBe('同学甲'); await request('/chat', 'DELETE', undefined, student.cookie); expect(db.db.prepare('SELECT count(*) AS count FROM messages').get()!.count).toBe(1) })
  it('exports a real task calendar and denies inaccessible tasks', async () => { const owner = await signup(); const other = await signup('其他班'); await publish(owner); const task = (await getTasks(owner))[0]; const response = await request(`/tasks/${task.id}/calendar.ics`, 'GET', undefined, owner.cookie); expect(response.headers.get('content-type')).toContain('text/calendar'); expect(await response.text()).toContain('DTSTART:20261012T100000Z'); expect((await request(`/tasks/${task.id}/calendar.ics`, 'GET', undefined, other.cookie)).status).toBe(404) })
})

describe('validation and date boundaries', () => {
  it('requires a real source date and timezone-aware deadlines', () => { expect(draftSchema.safeParse(draft({ sourceDate: '2026-02-30' })).success).toBe(false); expect(draftSchema.safeParse(draft({ tasks: [{ ...draft().tasks[0], dueAt: '2026-10-12T18:00:00' }] })).success).toBe(false); expect(draftSchema.safeParse(draft({ tasks: [{ ...draft().tasks[0], dueAt: null }] })).success).toBe(true) })
  it('escapes calendar newlines and folds Chinese lines to at most 75 UTF-8 bytes', () => { const text = calendar({ id: 'x', title: '运动会报名'.repeat(30), description: 'a,b;c\\d\n下一行', dueAt: '2026-10-12T18:00:00+08:00' }); expect(text).toContain('DESCRIPTION:a\\,b\\;c\\\\d\\n下一行'); for (const line of text.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75) })
})
