import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import app from '../server/index'
import { calendar, draftSchema } from '../server/validation'
import type { Env } from '../server/types'
import { INITIAL_CLASS_ID, initialRoster, weekSevenCourses, semesterEvents } from '../server/initialization'

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
  constructor() { for(const file of ['0001_initial.sql','0002_members.sql','0003_join_policy.sql','0004_member_removal.sql','0005_timetable_duty.sql','0006_notice_categories.sql','0007_academics.sql','0008_calendar.sql','0009_votes.sql','0010_reminders.sql','0011_accounts.sql','0012_schedule_detail.sql']) this.db.exec(readFileSync(new URL('../migrations/'+file, import.meta.url), 'utf8')) }
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
  const response = await request('/classes', 'POST', { name, nickname, username: `faculty_${crypto.randomUUID().slice(0, 8)}`, password: 'Banshu2026' })
  expect(response.status).toBe(200)
  return { ...(await response.json()) as any, cookie: response.headers.get('set-cookie')!.split(';')[0], response }
}
async function join(owner: any, nickname = '同学甲') {
  const number = `20${crypto.randomUUID().replace(/\D/g,'').slice(0, 10).padEnd(10,'0')}`
  const existing = db.db.prepare('SELECT id,student_no FROM members WHERE class_id=? AND nickname=? AND deleted_at IS NULL').get(owner.classroom.id,nickname) as {id:string;student_no:string|null}|undefined
  if (existing) db.db.prepare('UPDATE members SET student_no=? WHERE id=?').run(existing.student_no || number,existing.id)
  else await request('/class/members/import','POST',{text:`${nickname},${number}`},owner.cookie)
  const studentNo = (db.db.prepare('SELECT student_no FROM members WHERE class_id=? AND nickname=? AND deleted_at IS NULL').get(owner.classroom.id,nickname) as {student_no:string}).student_no
  const response = await request('/activate', 'POST', { inviteCode: owner.classroom.inviteCode, studentNo, password:'Student2026', confirmPassword:'Student2026' })
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
    expect(await response.json()).toEqual({ reply: '明天周五没有值日安排' })
    expect(db.db.prepare('SELECT count(*) AS count FROM actions').get()!.count).toBe(0)
    expect(db.db.prepare('SELECT count(*) AS count FROM messages').get()!.count).toBe(0)
    expect((await request('/chat', 'POST', { message: '明天谁值日？', history: [], data: {} })).status).toBe(401)
  })

  it('feeds database schedule to SSE tools without sending student numbers to the provider', async () => {
    env.API_KEY = 'server-only-test-key'
    const owner = await signup()
    await request('/class/members/import', 'POST', { text: '同学甲,NO-LEAK-773' }, owner.cookie)
    const saved = await request('/class/schedule', 'PUT', { timetable: [{ day: '周一', time: '08:00-09:40', course: '数据库课程', room: '教3102' }], duty: [] }, owner.cookie)
    expect(saved.status).toBe(200)
    let call = 0
    const provider = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body)
      expect(JSON.stringify(body)).not.toContain('NO-LEAK-773')
      return Response.json({ choices: [{ message: call++ === 0
        ? { content: null, tool_calls: [{ id: 'schedule', type: 'function', function: { name: 'get_timetable', arguments: '{"day":"周一"}' } }] }
        : { content: '周一有数据库课程。' } }] })
    })
    vi.stubGlobal('fetch', provider)
    const response = await request('/chat', 'POST', { message: '周一有什么课？' }, owner.cookie)
    const stream = await response.text()
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(stream).toContain('周一有数据库课程')
    const providerBodies = provider.mock.calls.map(call => JSON.parse(String(call[1].body)))
    expect(JSON.stringify(providerBodies)).toContain('08:00-09:40 数据库课程，教3102，教师待确认')
  })
})

describe('second release class features', () => {
  it('isolates academic data, calendar writes, and reminder settings by role', async () => {
    const owner=await signup(), student=await join(owner), other=await signup('其他班级')
    expect((await request('/academics','GET',undefined,student.cookie)).status).toBe(200)
    expect((await request(`/academics?memberId=${owner.user.id}`,'GET',undefined,student.cookie)).status).toBe(403)
    expect((await request('/calendar/exams','POST',{name:'英语四级',category:'考证',examAt:'2027-06-12T09:00:00+08:00'},student.cookie)).status).toBe(403)
    expect((await request('/calendar/exams','POST',{name:'英语四级',category:'考证',examAt:'2027-06-12T09:00:00+08:00'},owner.cookie)).status).toBe(200)
    const own=await (await request('/calendar','GET',undefined,student.cookie)).json() as any
    const foreign=await (await request('/calendar','GET',undefined,other.cookie)).json() as any
    expect(own.exams).toHaveLength(1);expect(foreign.exams).toHaveLength(0)
    expect((await request('/reminders/rules','PUT',[{type:'exam',enabled:false,daysBefore:7}],student.cookie)).status).toBe(403)
  })

  it('allows one anonymous vote per member and never stores their member ID', async () => {
    const owner=await signup(), student=await join(owner), other=await signup('其他班级')
    const creation=await request('/votes','POST',{title:'活动时间',anonymous:true,closesAt:'2027-12-31T12:00:00+08:00',options:['周六','周日']},owner.cookie)
    expect(creation.status).toBe(200)
    const voteId=(await creation.json() as any).id
    const option=(await (await request('/votes','GET',undefined,student.cookie)).json() as any).votes[0].options[0].id
    expect((await request(`/votes/${voteId}/cast`,'POST',{optionId:option},student.cookie)).status).toBe(200)
    expect((await request(`/votes/${voteId}/cast`,'POST',{optionId:option},student.cookie)).status).toBe(409)
    expect(db.db.prepare('SELECT member_id FROM vote_records').get()!.member_id).toBeNull()
    expect((await (await request('/votes','GET',undefined,other.cookie)).json() as any).votes).toHaveLength(0)
    expect((await request(`/votes/${voteId}/end`,'POST',{},student.cookie)).status).toBe(403)
    expect((await request(`/votes/${voteId}/end`,'POST',{},owner.cookie)).status).toBe(200)
  })
})
describe('class timetable and duty data',()=>{
 it('requires an admin to replace validated schedule data and isolates classes',async()=>{
  const owner=await signup(), student=await join(owner), other=await signup('另一个班')
  const body={timetable:[{day:'周一',time:'08:00-09:40',course:'高等数学',room:'教3102'}],duty:[{day:'周一',name:'同学甲'}]}
  expect((await request('/class/schedule','PUT',body,student.cookie)).status).toBe(403)
  expect((await request('/class/schedule','PUT',body,owner.cookie)).status).toBe(200)
  expect(await (await request('/class/schedule','GET',undefined,owner.cookie)).json()).toMatchObject(body)
  expect(await (await request('/class/schedule','GET',undefined,other.cookie)).json()).toMatchObject({timetable:[],duty:[]})
  expect((await request('/class/schedule','PUT',{...body,timetable:[{day:'周八',time:'xx',course:'',room:''}]},owner.cookie)).status).toBe(400)
  expect((await request('/class/schedule','PUT',{...body,duty:[{day:'周一',name:'不存在'}]},owner.cookie)).status).toBe(400)
 })
 it('imports weekday schedule and duty CSV with line errors and never returns student numbers',async()=>{
  const owner=await signup();await request('/class/members/import','POST',{text:'张三,STUDENT-SECRET\n李四,002'},owner.cookie)
  const response=await request('/class/schedule/import','POST',{timetable:'day,time,course,room\n周一,08:00-09:40,高数,教3102\n周八,xx,坏行,',duty:'day,name\n周一,张三\n周二,查无此人'},owner.cookie)
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({timetable:{imported:1,failed:1},duty:{imported:1,failed:1}})
  const saved=await (await request('/class/schedule','GET',undefined,owner.cookie)).json() as any
  expect(saved.timetable).toHaveLength(1);expect(saved.duty).toMatchObject([{day:'周一',member:'张三'}]);expect(JSON.stringify(saved)).not.toContain('STUDENT-SECRET')
 })
})
async function prepare(owner: any, value = draft()) { const response = await request('/drafts', 'POST', value, owner.cookie); expect(response.status).toBe(200); return (await response.json() as any).action }
async function publish(owner: any, value = draft()) { const action = await prepare(owner, value); const response = await request(`/actions/${action.id}/confirm`, 'POST', {}, owner.cookie); expect(response.status).toBe(200); return (await response.json() as any).result }
async function getTasks(user: any) { return (await (await request('/tasks', 'GET', undefined, user.cookie)).json() as any).tasks }
async function taskAction(user: any, task: any, status = 'completed') { const response = await request('/actions', 'POST', { type: 'task_status', taskId: task.id, version: task.version, status }, user.cookie); expect(response.status).toBe(200); return (await response.json() as any).action }

describe('identity and authentication', () => {
  it('hashes passwords, locks after five failures and requires reset to reactivate', async () => {
    const owner = await signup()
    const account = db.db.prepare('SELECT username,password_hash FROM members WHERE id=?').get(owner.user.id) as {username:string;password_hash:string}
    expect(account.password_hash).toMatch(/^pbkdf2-sha256\$100000\$/)
    expect(account.password_hash).not.toContain('Banshu2026')
    for (let attempt=0;attempt<4;attempt++) expect((await request('/login','POST',{account:account.username,password:'Wrong2026'})).status).toBe(401)
    expect((await request('/login','POST',{account:account.username,password:'Wrong2026'})).status).toBe(401)
    expect((await request('/login','POST',{account:account.username,password:'Banshu2026'})).status).toBe(429)
    const student = await join(owner)
    expect((await request(`/class/members/${student.user.id}/reset-password`,'POST',{},owner.cookie)).status).toBe(200)
    expect((await request('/session','GET',undefined,student.cookie)).status).toBe(401)
    const studentNo = (db.db.prepare('SELECT student_no FROM members WHERE id=?').get(student.user.id) as {student_no:string}).student_no
    expect((await request('/login','POST',{account:studentNo,password:'Student2026'})).status).toBe(403)
    expect((await request('/activate','POST',{studentNo,inviteCode:owner.classroom.inviteCode,password:'Again2026',confirmPassword:'Again2026'})).status).toBe(200)
  })
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
  it('activates once and then signs in with a password', async () => { const owner = await signup(); await request('/class/members/import','POST',{text:'同学甲,202601'},owner.cookie); const student=await join(owner); const r=await request('/login','POST',{account:'202601',password:'Student2026'}); expect(r.status).toBe(200); expect((await r.json() as any).user.id).toBe(student.user.id); expect((await request('/activate','POST',{inviteCode:owner.classroom.inviteCode,studentNo:'202601',password:'Student2026',confirmPassword:'Student2026'})).status).toBe(409); expect((await request('/activate','POST',{inviteCode:owner.classroom.inviteCode,studentNo:'999',password:'Student2026',confirmPassword:'Student2026'})).status).toBe(403) })
  it('removes recovery credentials and disables recovery endpoint', async () => { const owner = await signup(); expect(owner.recoveryCode).toBeUndefined(); expect((await request('/session/recover', 'POST', { recoveryCode: 'x'.repeat(64) })).status).toBe(404); const demo=await (await request('/demo','POST',{role:'admin'})).json() as any; expect(demo.recoveryCode).toBeUndefined() })
  it('revokes the current session on logout', async () => { const owner = await signup(); expect((await request('/session', 'DELETE', undefined, owner.cookie)).status).toBe(200); expect((await request('/session', 'GET', undefined, owner.cookie)).status).toBe(401) })
  it('rotates invitation codes without removing existing members', async () => { const owner = await signup(); const student = await join(owner); const response = await request('/invite/rotate', 'POST', {}, owner.cookie); expect(response.status).toBe(200); expect((await request('/activate', 'POST', { inviteCode: owner.classroom.inviteCode, studentNo: '999',password:'Student2026',confirmPassword:'Student2026' })).status).toBe(403); expect((await request('/session', 'GET', undefined, student.cookie)).status).toBe(200) })
  it('blocks cross-origin mutations and invalid JSON', async () => { expect((await request('/classes', 'POST', { name: 'X', nickname: 'Y' }, undefined, { Origin: 'https://evil.example' })).status).toBe(403); const response = await app.request('https://class.test/api/classes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }, env); expect(response.status).toBe(400) })
  it('keeps each demo class separate from other demo and real classes', async () => { const one = await (await request('/demo', 'POST', { role: 'admin' })).json() as any; const two = await (await request('/demo', 'POST', { role: 'student' })).json() as any; const real = await signup(); expect(one.mode).toBe('demo'); expect(one.classroom.id).not.toBe(two.classroom.id); expect(one.classroom.id).not.toBe(real.classroom.id) })
})

describe('initial class reset', () => {
  it('retains faculty and seeds the specified roster, schedule and calendar only in that class', async () => {
    const owner=await signup(), other=await signup('另一班')
    db.db.exec('PRAGMA foreign_keys=OFF')
    db.db.prepare('UPDATE classes SET id=? WHERE id=?').run(INITIAL_CLASS_ID,owner.classroom.id)
    db.db.prepare('UPDATE members SET class_id=? WHERE class_id=?').run(INITIAL_CLASS_ID,owner.classroom.id)
    db.db.exec('PRAGMA foreign_keys=ON')
    const response=await request('/class/reset','POST',{confirmation:'清空本班数据'},owner.cookie)
    expect(response.status).toBe(200)
    expect(db.db.prepare('SELECT count(*) AS n FROM members WHERE class_id=? AND deleted_at IS NULL').get(INITIAL_CLASS_ID)!.n).toBe(initialRoster.length+1)
    expect(db.db.prepare('SELECT count(*) AS n FROM timetable_entries WHERE class_id=?').get(INITIAL_CLASS_ID)!.n).toBe(weekSevenCourses.length)
    expect(db.db.prepare('SELECT count(*) AS n FROM calendar_events WHERE class_id=?').get(INITIAL_CLASS_ID)!.n).toBe(semesterEvents.length)
    expect(db.db.prepare('SELECT nickname FROM members WHERE id=?').get(owner.user.id)!.nickname).toBe('罗文杰')
    expect(db.db.prepare('SELECT count(*) AS n FROM members WHERE class_id=?').get(other.classroom.id)!.n).toBe(1)
  })
})

describe('confirmed AI actions', () => {
  it('resets a class only once through an owned confirmation card',async()=>{
    const owner=await signup(),other=await signup('其他班');await publish(owner);const prepared=db.db.prepare('INSERT INTO actions(id,class_id,member_id,type,payload,expires_at) VALUES(?,?,?,?,?,?)');prepared.run('reset-action',owner.classroom.id,owner.user.id,'class_reset','{}',new Date(Date.now()+60000).toISOString());
    expect((await request('/actions/reset-action/confirm','POST',{},other.cookie)).status).toBe(404);
    expect((await request('/actions/reset-action/confirm','POST',{},owner.cookie)).status).toBe(200);
    expect(db.db.prepare('SELECT count(*) AS n FROM notices WHERE class_id=?').get(owner.classroom.id)!.n).toBe(0);
    expect((await request('/actions/reset-action/confirm','POST',{},owner.cookie)).status).toBe(200);
    expect(db.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='class_reset' AND class_id=?").get(owner.classroom.id)!.n).toBe(1);
    expect(db.db.prepare('SELECT count(*) AS n FROM members WHERE class_id=?').get(other.classroom.id)!.n).toBe(1);
  });
  it('prepares a vote without writing, then confirms it once in the same class', async () => {
    env.API_KEY='test-only-key';const owner=await signup(),other=await signup('第二班');let call=0;
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({choices:[{message:call++===0?{content:null,tool_calls:[{id:'vote-call',type:'function',function:{name:'prepare_vote',arguments:JSON.stringify({title:'周末聚餐',description:'班级活动',closesAt:'2027-10-10T18:00:00+08:00',options:['参加','不参加']})}}]}:{content:'投票确认卡已准备好，请确认。'}}]})));
    const response=await request('/chat','POST',{message:'发起投票：周末聚餐去不去'},owner.cookie);
    expect(response.status).toBe(200);const stream=await response.text();expect(stream).toContain('create_vote');
    const action=db.db.prepare("SELECT id FROM actions WHERE class_id=? AND type='create_vote'").get(owner.classroom.id) as {id:string};
    expect(db.db.prepare('SELECT count(*) AS n FROM votes').get()!.n).toBe(0);
    expect((await request(`/actions/${action.id}/confirm`,'POST',{},other.cookie)).status).toBe(404);
    expect((await request(`/actions/${action.id}/confirm`,'POST',{},owner.cookie)).status).toBe(200);
    expect((await request(`/actions/${action.id}/confirm`,'POST',{},owner.cookie)).status).toBe(200);
    expect(db.db.prepare('SELECT count(*) AS n FROM votes WHERE class_id=?').get(owner.classroom.id)!.n).toBe(1);
    expect(db.db.prepare('SELECT count(*) AS n FROM votes WHERE class_id=?').get(other.classroom.id)!.n).toBe(0);
  });

  it('keeps management tools unavailable to students even when a provider requests one', async () => {
    env.API_KEY='test-only-key';const owner=await signup(),student=await join(owner);let call=0;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:any)=>{const body=JSON.parse(init.body);if(call===0){expect(body.tools.map((tool:any)=>tool.function.name)).not.toContain('prepare_member_role');expect(body.tools.map((tool:any)=>tool.function.name)).toContain('prepare_personal_tasks')}return Response.json({choices:[{message:call++===0?{content:null,tool_calls:[{id:'role-call',type:'function',function:{name:'prepare_member_role',arguments:'{"memberName":"同学甲","role":"cadre"}'}}]}:{content:'没有权限修改角色。'}}]})}));
    const response=await request('/chat','POST',{message:'把同学甲设为班干部'},student.cookie);
    expect(await response.text()).toContain('没有权限');
    expect(db.db.prepare("SELECT count(*) AS n FROM actions WHERE type='member_role'").get()!.n).toBe(0);
  });
})

describe('faculty transfer',()=>{
  it('retires the old account and gives the activated successor a faculty username',async()=>{
    const owner=await signup(),successor=await join(owner),other=await signup('隔离班');
    const result=await request('/class/faculty/transfer','POST',{memberId:successor.user.id,username:'successor_2026'},owner.cookie);
    expect(result.status).toBe(200);
    expect((await request('/session','GET',undefined,owner.cookie)).status).toBe(401);
    expect((await request('/session','GET',undefined,successor.cookie)).status).toBe(401);
    const login=await request('/login','POST',{account:'successor_2026',password:'Student2026'});
    expect(login.status).toBe(200);
    expect((await login.json() as any).user.accessRole).toBe('faculty');
    expect(db.db.prepare('SELECT count(*) AS n FROM members WHERE class_id=? AND access_role=? AND deleted_at IS NULL').get(owner.classroom.id,'faculty')!.n).toBe(1);
    expect(db.db.prepare('SELECT count(*) AS n FROM members WHERE class_id=? AND access_role=? AND deleted_at IS NULL').get(other.classroom.id,'faculty')!.n).toBe(1);
    expect(db.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
})

describe('week-specific schedule preservation',()=>{
  it('keeps seeded week-seven courses when recurring rows are edited or imported',async()=>{
    const owner=await signup();
    db.db.prepare('INSERT INTO timetable_entries(id,class_id,weekday,period,course,room,position,week_start,period_number,teacher) VALUES(?,?,?,?,?,?,?,?,?,?)').run('week-seven',owner.classroom.id,'周一','08:00-08:45','第七周课程','文202',1,'2026-10-12',1,'任课教师');
    expect((await request('/class/schedule','PUT',{timetable:[{day:'周二',time:'10:00-10:45',course:'常规课程',room:'教101'}],duty:[]},owner.cookie)).status).toBe(200);
    expect((await request('/class/schedule/import','POST',{timetable:'day,time,course,room\n周三,14:30-15:15,导入课程,教102',duty:''},owner.cookie)).status).toBe(200);
    expect(db.db.prepare("SELECT count(*) AS n FROM timetable_entries WHERE class_id=? AND week_start='2026-10-12'").get(owner.classroom.id)!.n).toBe(1);
    expect(db.db.prepare("SELECT count(*) AS n FROM timetable_entries WHERE class_id=? AND week_start IS NULL").get(owner.classroom.id)!.n).toBe(2);
  });
})

describe('business permissions and confirmations', () => {
  it('filters class notices by category and search, with important pinned notices first', async () => {
    const owner = await signup(), student = await join(owner), other = await signup('其他班')
    const categories = await (await request('/notice-categories', 'GET', undefined, student.cookie)).json() as any
    expect(categories.categories.map((c:any) => c.name)).toEqual(['重要公告','组队通知','考证考试','活动报名','日常事务'])
    const ordinary = await publish(owner, draft({ title: '普通运动会', categoryId: 'activity' }))
    const important = await publish(owner, draft({ title: '重要考试', categoryId: 'important', pinned: true, priority: 'high', sourceTime: '2026-10-08T09:00:00+08:00' }))
    const all = (await (await request('/notices', 'GET', undefined, student.cookie)).json() as any).notices
    expect(all.map((n:any) => n.id)).toEqual([important.noticeId, ordinary.noticeId])
    expect(all[0]).toMatchObject({ categoryId: 'important', categoryName: '重要公告', priority: 'high', pinned: true, sourceTime: '2026-10-08T09:00:00+08:00' })
    expect((await (await request('/notices?category=activity&q=%E8%BF%90%E5%8A%A8', 'GET', undefined, student.cookie)).json() as any).notices).toHaveLength(1)
    expect((await (await request('/notices?q=%E8%80%83%E8%AF%95', 'GET', undefined, other.cookie)).json() as any).notices).toHaveLength(0)
    expect((await request('/notices?category=unknown', 'GET', undefined, owner.cookie)).status).toBe(400)
  })
  it('validates category and pinning through draft confirmation and versioned edits', async () => {
    const owner = await signup(), student = await join(owner)
    expect((await request('/drafts', 'POST', draft({ categoryId: 'invalid' }), owner.cookie)).status).toBe(400)
    expect((await request('/drafts', 'POST', draft({ categoryId: 'team', pinned: true }), owner.cookie)).status).toBe(400)
    const action = await prepare(owner, draft({ categoryId: 'important', pinned: true }))
    expect((await request(`/actions/${action.id}/confirm`, 'POST', { draft: draft({ categoryId: 'team', pinned: true }) }, owner.cookie)).status).toBe(400)
    const result = await request(`/actions/${action.id}/confirm`, 'POST', {}, owner.cookie)
    expect(result.status).toBe(200)
    const noticeId = (await result.json() as any).result.noticeId
    expect((await request(`/notices/${noticeId}`, 'PATCH', { version: 1, pinned: false }, student.cookie)).status).toBe(403)
    expect((await request(`/notices/${noticeId}`, 'PATCH', { version: 1, categoryId: 'team' }, owner.cookie)).status).toBe(400)
    const edited = await request(`/notices/${noticeId}`, 'PATCH', { version: 1, categoryId: 'team', pinned: false }, owner.cookie)
    expect(edited.status).toBe(200)
    expect((await edited.json() as any).notice).toMatchObject({ categoryId: 'team', pinned: false, version: 2 })
  })
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

describe('member import', () => {
  it('imports 50 usable members and skips duplicates with line reasons', async () => {
    const owner = await signup()
    const text = 'name,student_no,role,note\n' + Array.from({length:50}, (_,i)=>`学生${i},S${i},成员,备注${i}`).join('\n')
    const res = await request('/class/members/import', 'POST', {text}, owner.cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({imported:50,skipped:0,failed:0})
    const again = await request('/class/members/import', 'POST', {text:'name,student_no,role,note\n不同名字,S0,成员,\n学生1,,成员,\n坏角色,S99,老师,\n"带,逗号",S100,班干部,"两行\n备注"'}, owner.cookie)
    expect(await again.json()).toMatchObject({imported:1,skipped:1,failed:2,errors:expect.arrayContaining([expect.objectContaining({line:4})])})
    const roster = await (await request('/members','GET',undefined,owner.cookie)).json() as any
    expect(roster.members).toHaveLength(52)
    expect(roster.members.find((m:any)=>m.studentNo==='S100')).toMatchObject({nickname:'带,逗号',role:'cadre',note:'两行\n备注'})
  })
  it('requires admin and validates input/header while allowing the same number in another class', async () => {
    const owner = await signup(), student = await join(owner), other = await signup('别班')
    expect((await request('/class/members/import','POST',{text:'学生,1'},student.cookie)).status).toBe(403)
    expect((await request('/class/members/import','POST',{text:''},owner.cookie)).status).toBe(400)
    expect((await request('/class/members/import','POST',{text:'name,name\n学生,学生'},owner.cookie)).status).toBe(400)
    expect(await (await request('/class/members/import','POST',{text:'学生,1'},owner.cookie)).json()).toMatchObject({imported:1})
    expect(await (await request('/class/members/import','POST',{text:'学生,1'},other.cookie)).json()).toMatchObject({imported:0,skipped:1})
  })
})


describe('join policy',()=>{
 it('keeps class settings faculty-only and disables old invite login',async()=>{
  const owner=await signup();const student=await join(owner);
  expect((await request('/class/settings','PATCH',{allowSelfJoin:true},student.cookie)).status).toBe(403);
  expect((await request('/class/settings','PATCH',{name:'新班名'},owner.cookie)).status).toBe(200);
  expect((await request('/join','POST',{inviteCode:owner.classroom.inviteCode,nickname:'新同学'})).status).toBe(410);
 });
 it('rejects activation when student number and invite code do not belong together',async()=>{
  const owner=await signup();await request('/class/members/import','POST',{text:'同学甲,001\n同学乙,002'},owner.cookie);
  const other=await signup('其他班');
  expect((await request('/activate','POST',{inviteCode:other.classroom.inviteCode,studentNo:'001',password:'Student2026',confirmPassword:'Student2026'})).status).toBe(403);
 });
})

describe('member administration',()=>{
 it('changes roles, revokes sessions and protects the faculty account',async()=>{
  const owner=await signup(), student=await join(owner);
  expect((await request(`/class/members/${owner.user.id}`,'PATCH',{role:'student'},owner.cookie)).status).toBe(403);
  expect((await request(`/class/members/${owner.user.id}`,'DELETE',{},owner.cookie)).status).toBe(403);
  expect((await request(`/class/members/${owner.user.id}`,'PATCH',{role:'student'},student.cookie)).status).toBe(403);
  expect((await request(`/class/members/${student.user.id}`,'PATCH',{role:'cadre'},owner.cookie)).status).toBe(200);
  expect((await request('/session','GET',undefined,student.cookie)).status).toBe(401);
  expect(db.db.prepare("SELECT count(*) count FROM members WHERE access_role='faculty' AND deleted_at IS NULL").get()!.count).toBe(1);
 });
 it('removes members from login/roster/statistics but preserves authorship and references',async()=>{
  const owner=await signup();await request('/class/members/import','POST',{text:'同学甲,001'},owner.cookie);const student=await join(owner);const pub=await publish(owner);const task=(await getTasks(student))[0];const action=await taskAction(student,task);await request(`/actions/${action.id}/confirm`,'POST',{},student.cookie);
  await request(`/class/members/${student.user.id}`,'PATCH',{role:'cadre'},owner.cookie);const authorLogin=await request('/login','POST',{account:'001',password:'Student2026'});const author={cookie:authorLogin.headers.get('set-cookie')!.split(';')[0]};await publish(author);
  expect((await request(`/class/members/${student.user.id}`,'DELETE',{},owner.cookie)).status).toBe(200);
  expect((await request('/session','GET',undefined,author.cookie)).status).toBe(401);
  expect((await request('/login','POST',{account:'001',password:'Student2026'})).status).toBe(401);
  const roster=await (await request('/members','GET',undefined,owner.cookie)).json() as any;expect(roster.members).toHaveLength(1);
  const progress=await (await request(`/tasks/${task.id}/progress`,'GET',undefined,owner.cookie)).json() as any;expect(progress.total).toBe(1);
  expect(db.db.prepare('SELECT count(*) count FROM task_status WHERE member_id=?').get(student.user.id)!.count).toBe(1);
  const ns=await (await request('/notices','GET',undefined,owner.cookie)).json() as any;expect(ns.notices.some((n:any)=>n.authorName==='同学甲')).toBe(true);
  expect(await (await request('/class/members/import','POST',{text:'同学甲,001'},owner.cookie)).json()).toMatchObject({imported:1});
  const replacement=await join(owner);expect(replacement.user.id).not.toBe(student.user.id);
  expect((await request(`/notices/${pub.noticeId}`,'GET',undefined,owner.cookie)).status).toBe(200);
  expect(db.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 });
 it('does not modify another class member',async()=>{
  const owner=await signup(),other=await signup('别班');
  expect((await request(`/class/members/${other.user.id}`,'DELETE',{},owner.cookie)).status).toBe(404);
  expect((await request(`/class/members/${other.user.id}`,'PATCH',{role:'student'},owner.cookie)).status).toBe(404);
 });
 it('handles two concurrent imports without rolling back other valid rows',async()=>{
  const owner=await signup();const responses=await Promise.all([request('/class/members/import','POST',{text:'同学甲,001\n同学乙,002'},owner.cookie),request('/class/members/import','POST',{text:'同学甲,001\n同学丙,003'},owner.cookie)]);
  expect(responses.map(r=>r.status)).toEqual([200,200]);const results=await Promise.all(responses.map(r=>r.json() as Promise<any>));expect(results.reduce((n,r)=>n+r.imported,0)).toBe(3);expect(results.reduce((n,r)=>n+r.skipped,0)).toBe(1);
 })
})


describe('member migration compatibility',()=>{
 it('preserves populated legacy foreign keys and active name uniqueness',()=>{
  const legacy=new DatabaseSync(':memory:');try{
   for(const file of ['0001_initial.sql','0002_members.sql','0003_join_policy.sql'])legacy.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
   legacy.prepare('INSERT INTO classes(id,name,invite_code,created_at) VALUES(?,?,?,?)').run('c','班级','CODE','now');
   legacy.prepare('INSERT INTO members(id,class_id,nickname,role,recovery_hash,created_at,student_no,note) VALUES(?,?,?,?,?,?,?,?)').run('m','c','管理员','admin','hash','now','001','备注');
   legacy.prepare('INSERT INTO sessions VALUES(?,?,?)').run('token','m','future');
   legacy.prepare('INSERT INTO notices(id,class_id,author_id,title,content,source_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('n','c','m','旧通知','正文','2026-10-09','now','now');
   legacy.exec('BEGIN');legacy.exec(readFileSync(new URL('../migrations/0004_member_removal.sql',import.meta.url),'utf8'));legacy.exec('COMMIT');
   expect(legacy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
   expect(legacy.prepare('SELECT nickname,student_no,note FROM members').get()).toMatchObject({nickname:'管理员',student_no:'001',note:'备注'});
   expect(legacy.prepare('SELECT author_id FROM notices').get()!.author_id).toBe('m');expect(legacy.prepare('SELECT member_id FROM sessions').get()!.member_id).toBe('m');
  }finally{legacy.close()}
 })
})
