import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { beijingDate } from '../server/validation'
import { demoChat, executeTool, liveChat, banshuChat } from '../server/ai'
import { mode } from '../server/auth'
import type { Env, Identity } from '../server/types'

class Statement {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}
  bind(...args: unknown[]) { return new Statement(this.db, this.sql, args) }
  async first() { return this.db.prepare(this.sql).get(...this.args as never[]) ?? null }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args as never[]) } }
  async run() { const r = this.db.prepare(this.sql).run(...this.args as never[]); return { meta: { changes: Number(r.changes) } } }
  execute() { return this.db.prepare(this.sql).run(...this.args as never[]) }
}
class SqliteD1 {
  db = new DatabaseSync(':memory:')
  constructor() { this.db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')) }
  prepare(sql: string) { return new Statement(this.db, sql) }
  async batch(statements: Statement[]) { this.db.exec('BEGIN'); try { const result = statements.map(s => s.execute()); this.db.exec('COMMIT'); return result } catch (error) { this.db.exec('ROLLBACK'); throw error } }
}

const now = new Date().toISOString()
const today = beijingDate()
const admin: Identity = { user: { id: 'admin-1', classId: 'class-1', nickname: '班干部', role: 'admin' }, classroom: { id: 'class-1', name: '示例班', isDemo: true } }
const student: Identity = { user: { id: 'student-1', classId: 'class-1', nickname: '同学甲', role: 'student' }, classroom: { id: 'class-1', name: '示例班', isDemo: true } }
const realAdmin: Identity = { ...admin, classroom: { ...admin.classroom, isDemo: false } }
const realStudent: Identity = { ...student, classroom: { ...student.classroom, isDemo: false } }
let db: SqliteD1
let env: Env

function seed() {
  db.db.prepare('INSERT INTO classes VALUES(?,?,?,?,?)').run('class-1', '示例班', 'DEMO-1', 1, now)
  db.db.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run('admin-1', 'class-1', '班干部', 'admin', 'admin-hash', now)
  db.db.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run('student-1', 'class-1', '同学甲', 'student', 'student-hash', now)
  db.db.prepare('INSERT INTO notices VALUES(?,?,?,?,?,?,?,?,?,?)').run('notice-1', 'class-1', 'admin-1', '运动会报名通知', '请提交运动会报名表。', today, 'published', 1, now, now)
  db.db.prepare('INSERT INTO notice_versions VALUES(?,?,?,?,?)').run('notice-1', 1, '运动会报名通知', '请提交运动会报名表。', now)
  const overdueDate = '2020-01-01T12:00:00+08:00'
  for (const [id, title, due] of [['task-1', '运动会报名表', overdueDate], ['task-2', '运动会报名信息', `${today}T18:00:00+08:00`], ['task-3', '未定日期材料', null] as const]) {
    db.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?)').run(id, 'notice-1', 'class-1', title, '请按通知完成。', due, id === 'task-3' ? 'selected' : 'all', 1)
  }
  db.db.prepare('INSERT INTO task_recipients VALUES(?,?)').run('task-3', 'student-1')
}

beforeEach(() => { db = new SqliteD1(); env = { DB: db as unknown as D1Database, AI_API_KEY: 'provider-secret' }; seed() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.db.close() })

function mockProvider(messages: unknown[]) {
  let index = 0
  const fetchMock = vi.fn(async (_url: unknown, _options: RequestInit) => Response.json({ choices: [{ message: messages[Math.min(index++, messages.length - 1)] }] }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('native Banshu tool contract', () => {
  it('enables the real mode with either server-side key name', () => {
    expect(mode({ DB: env.DB, API_KEY: 'test-key' }, realStudent)).toBe('live')
    expect(mode({ DB: env.DB, API_KEY: 'test-key' }, student)).toBe('demo')
  })

  it('uses DeepSeek-compatible tool calls to answer tomorrow duty', async () => {
    const fetchMock = mockProvider([
      { content: null, tool_calls: [{ id: 'duty-1', type: 'function', function: { name: 'get_duty', arguments: '{"day":"周五"}' } }] },
      { content: '明天周五由张三值日。' },
    ])
    const reply = await banshuChat(env, '明天谁值日？', [], { timetable: [], duty: [{ day: '周五', member: '张三' }], members: [{ name: '张三' }], notices: [] })
    expect(reply).toBe('明天周五由张三值日。')
    const second = JSON.parse(String(fetchMock.mock.calls[1][1].body))
    expect(second.messages.at(-1).content).toBe('周五值日：张三')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions')
  })

  it('executes every tool call returned in the same round', async () => {
    const fetchMock = mockProvider([
      { content: null, tool_calls: [
        { id: 'class-1', type: 'function', function: { name: 'get_timetable', arguments: '{"day":"周一"}' } },
        { id: 'notice-1', type: 'function', function: { name: 'get_notices', arguments: '{}' } },
        { id: 'plan-1', type: 'function', function: { name: 'generate_duty_plan', arguments: '{"days":2,"startDay":"周一"}' } },
      ] },
      { content: '已查询。' },
    ])
    await banshuChat(env, '查班务', [], { timetable: [{ day: '周一', time: '08:00-09:40', course: '高数', room: '教3102' }], duty: [], members: [{ name: '张三' }], notices: [{ title: '班会通知', content: '周五下午开会', date: '2026-10-10' }] })
    const second = JSON.parse(String(fetchMock.mock.calls[1][1].body))
    const outputs = second.messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content)
    expect(outputs).toEqual(['08:00-09:40 高数（教3102）', '班会通知（2026-10-10）：周五下午开会', '已生成2天值日建议，起始日为周一：\n第1天：张三\n第2天：张三'])
  })

  it('rejects invalid history and never includes a secret in provider failures', async () => {
    await expect(banshuChat(env, '你好', [{ role: 'system', content: '越权' }], {})).rejects.toHaveProperty('issues')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'provider-secret' }, { status: 401 })))
    await expect(banshuChat(env, '你好', [], {})).rejects.toSatisfy((e: any) => e.status === 502 && !e.message.includes('provider-secret'))
  })
})

describe('AI tool boundary and demo rules', () => {
  it('keeps the evaluation corpus as a 20-case reference without inventing model accuracy', () => {
    const corpus = JSON.parse(readFileSync(new URL('../docs/notification-cases.json', import.meta.url), 'utf8'))
    expect(corpus.cases).toHaveLength(20)
    expect(corpus.evaluationReferenceDate).toBe('2026-10-08')
    expect(corpus.cases.every((item: any) => typeof item.expected === 'object')).toBe(true)
  })

  it('rejects rule demo for a real class and never silently hides the mode', async () => {
    await expect(demoChat(env, realStudent, '我今天要做什么？')).rejects.toMatchObject({ status: 503 })
    await expect(liveChat({ DB: env.DB }, realStudent, '我今天要做什么？')).rejects.toMatchObject({ status: 503 })
  })

  it('marks rule answers as demo output and creates no write before confirmation', async () => {
    const result = await demoChat(env, student, '我今天要做什么？')
    expect(result.content).toMatch(/^【规则示例演示，未调用真实模型】/)
    expect(result.cards[0]).toMatchObject({ type: 'tasks' })
    expect(db.db.prepare('SELECT count(*) AS count FROM actions').get()!.count).toBe(0)
  })

  it('handles exact status intent before notice matching and leaves status pending', async () => {
    const result = await demoChat(env, student, '请把运动会报名表标记为已完成')
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]).toMatchObject({ type: 'action', action: { type: 'task_status' } })
    expect(db.db.prepare('SELECT count(*) AS count FROM task_status').get()!.count).toBe(0)
  })

  it('returns all candidate cards instead of arbitrarily choosing an ambiguous task', async () => {
    const result = await demoChat(env, student, '报名已完成')
    expect(result.cards[0].type).toBe('tasks')
    expect((result.cards[0] as any).tasks.map((task: any) => task.id)).toEqual(['task-1', 'task-2'])
    expect(db.db.prepare('SELECT count(*) AS count FROM actions').get()!.count).toBe(0)
  })

  it('turns an admin long paste into a null-date draft while preserving original content/date', async () => {
    const source = '整理通知：运动会报名\n请提交运动会报名表。\n请核对联系电话后确认报名信息，所有同学都需要逐项检查自己的报名项目。'
    const result = await demoChat(env, admin, source, '2026-10-08')
    const action = result.cards[0] as any
    expect(action.type).toBe('action')
    expect(action.action.payload.content).toBe(source)
    expect(action.action.payload.sourceDate).toBe('2026-10-08')
    expect(action.action.payload.tasks.length).toBeGreaterThan(0)
    expect(action.action.payload.tasks.every((task: any) => task.dueAt === null)).toBe(true)
    expect(db.db.prepare('SELECT count(*) AS count FROM notices').get()!.count).toBe(1)
  })

  it('implements all six tools with identity-scoped data and confirmation-only writes', async () => {
    const mine = await executeTool(env, student, 'get_my_tasks', { status: 'pending', fromDate: today, toDate: today, includeOverdue: true })
    expect('tasks' in mine && mine.tasks.map(t => t.id)).toEqual(['task-1', 'task-2'])
    const found = await executeTool(env, student, 'search_notices', { query: '报名' })
    expect('notices' in found && found.notices).toHaveLength(1)
    const detail = await executeTool(env, student, 'get_notice_detail', { noticeId: 'notice-1' })
    expect('notice' in detail && detail.notice.id).toBe('notice-1')
    const progress = await executeTool(env, admin, 'get_task_progress', { taskId: 'task-1' })
    expect('total' in progress && progress.total).toBe(2)
    const status = await executeTool(env, student, 'prepare_task_status_change', { taskId: 'task-1', status: 'completed' })
    expect('type' in status && status.type).toBe('task_status')
    const draft = await executeTool(env, admin, 'prepare_notice_draft', { title: '模型标题', tasks: [{ title: '模型任务', description: '', dueAt: null, audience: 'all', memberIds: [] }] }, { message: '原始通知正文', sourceDate: '2026-10-08' })
    expect('type' in draft && draft.type).toBe('publish_notice')
    expect('payload' in draft && draft.payload.content).toBe('原始通知正文')
    expect(db.db.prepare('SELECT count(*) AS count FROM notices').get()!.count).toBe(1)
  })

  it('rejects malformed tool arguments and denies admin-only tools for students', async () => {
    await expect(executeTool(env, student, 'get_my_tasks', { status: 'pending', unexpected: true })).rejects.toThrow()
    await expect(executeTool(env, student, 'get_task_progress', { taskId: 'task-1' })).rejects.toMatchObject({ status: 403 })
    await expect(executeTool(env, student, 'prepare_notice_draft', { title: 'x', tasks: [] }, { message: '正文' })).rejects.toMatchObject({ status: 403 })
  })
})

describe('live provider loop', () => {
  it('returns tool cards and sends trusted original source/date to the model tool result', async () => {
    const source = '原始通知：请在周五前提交材料。'
    const fetchMock = mockProvider([
      { content: null, tool_calls: [{ id: 'draft-1', type: 'function', function: { name: 'prepare_notice_draft', arguments: JSON.stringify({ title: '模型伪造标题', tasks: [{ title: '提交材料', description: '', dueAt: null, audience: 'all', memberIds: [] }] }) } }] },
      { content: '已生成待确认草稿。' },
    ])
    const result = await liveChat(env, realAdmin, source, '2026-10-08')
    expect(result.content).toBe('已生成待确认草稿。')
    expect(result.cards[0]).toMatchObject({ type: 'action', action: { type: 'publish_notice' } })
    const actionPayload = (result.cards[0] as any).action.payload
    expect(actionPayload.content).toBe(source)
    expect(actionPayload.sourceDate).toBe('2026-10-08')
    expect(actionPayload.title).toBe('模型伪造标题')
    expect(actionPayload.tasks[0].dueAt).toBeNull()
    expect(db.db.prepare('SELECT count(*) AS count FROM notices').get()!.count).toBe(1)
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(firstRequest.max_tokens).toBe(1800)
    expect(firstRequest.tools).toHaveLength(6)
  })

  it('returns a sanitized tool error when a student asks for an admin tool', async () => {
    const fetchMock = mockProvider([
      { content: null, tool_calls: [{ id: 'progress-1', type: 'function', function: { name: 'get_task_progress', arguments: JSON.stringify({ taskId: 'task-1' }) } }] },
      { content: '你没有查看班级进度的权限。' },
    ])
    const result = await liveChat(env, realStudent, '查看全班进度')
    expect(result.content).toContain('权限')
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(firstRequest.tools).toHaveLength(4)
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1][1].body))
    const toolMessage = secondRequest.messages.at(-1)
    expect(toolMessage.role).toBe('tool')
    expect(JSON.parse(toolMessage.content).error).toContain('班干部')
    expect(JSON.stringify(toolMessage)).not.toContain('student-1')
  })

  it('sanitizes provider failures and does not expose the API key', async () => {
    const fetchMock = vi.fn(async () => new Response('provider secret provider-secret', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(liveChat(env, realStudent, '查询待办')).rejects.toSatisfy((error: any) => error.status === 502 && !error.message.includes('provider-secret'))
  })

  it('maps an aborted provider fetch to a timeout-safe error', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => { expect(options.signal).toBe(controller.signal); controller.abort(); throw new DOMException('aborted', 'AbortError') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(liveChat(env, realStudent, '查询待办', undefined, undefined, controller.signal)).rejects.toSatisfy((error: any) => error.status === 504 && !error.message.includes('provider-secret'))
  })

  it('returns 503 before contacting a provider when no API key is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(liveChat({ DB: env.DB }, realStudent, '查询待办')).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports malformed provider tool arguments without executing a write', async () => {
    const fetchMock = mockProvider([
      { content: null, tool_calls: [{ id: 'bad-args', type: 'function', function: { name: 'prepare_notice_draft', arguments: '{bad json' } }] },
      { content: '参数有误，请重新说明。' },
    ])
    const result = await liveChat(env, realAdmin, '原始通知正文', '2026-10-08')
    expect(result.content).toContain('参数有误')
    expect(result.cards).toHaveLength(0)
    expect(db.db.prepare('SELECT count(*) AS count FROM notices').get()!.count).toBe(1)
  })
})


describe('provider context and execution limits', () => {
  it('uses the last 12 saved messages for this member in chronological order', async () => {
    for (let i = 0; i < 15; i++) db.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(`history-${i}`, student.user.id, i % 2 ? 'assistant' : 'user', `prior-${i}`, '[]', `2026-10-08T01:00:${String(i).padStart(2, '0')}.000Z`)
    db.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run('other-user', admin.user.id, 'user', 'OTHER MEMBER PRIVATE HISTORY', '[]', '2026-10-08T01:01:00.000Z')
    const fetchMock = mockProvider([{ content: '请继续。' }])
    await liveChat(env, realStudent, 'current-message')
    const request = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(request.messages.slice(1, -1).map((m: any) => m.content)).toEqual(Array.from({ length: 12 }, (_, i) => `prior-${i + 3}`))
    expect(request.messages.at(-1)).toEqual({ role: 'user', content: 'current-message' })
    expect(JSON.stringify(request.messages)).not.toContain('OTHER MEMBER PRIVATE HISTORY')
  })

  it('streams progress and returns source notice cards after a tool lookup', async () => {
    mockProvider([{ content: null, tool_calls: [{ id: 'notice-call', type: 'function', function: { name: 'get_notice_detail', arguments: '{"noticeId":"notice-1"}' } }] }, { content: '依据运动会报名通知，请提交报名表。' }])
    const events: string[] = []
    const result = await liveChat(env, realStudent, '报名要交什么？', undefined, async message => { events.push(message) })
    expect(events).toContain('正在核对通知原文…')
    expect(result.cards[0]).toMatchObject({ type: 'notice', notice: { id: 'notice-1', content: '请提交运动会报名表。' } })
    expect(result.cards[1]).toMatchObject({ type: 'tasks' })
  })

  it('rejects more than six tool calls in a single provider response before execution', async () => {
    mockProvider([{ content: null, tool_calls: Array.from({ length: 7 }, (_, i) => ({ id: `call-${i}`, type: 'function', function: { name: 'prepare_task_status_change', arguments: '{"taskId":"task-1","status":"completed"}' } })) }])
    await expect(liveChat(env, realStudent, '完成任务')).rejects.toMatchObject({ status: 502 })
    expect(db.db.prepare('SELECT count(*) AS count FROM actions').get()!.count).toBe(0)
  })

  it('stops after four provider rounds while retaining usable result cards', async () => {
    const fetchMock = mockProvider([{ content: null, tool_calls: [{ id: 'repeat-query', type: 'function', function: { name: 'get_my_tasks', arguments: '{}' } }] }])
    const result = await liveChat(env, realStudent, '全部待办')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.cards.length).toBeGreaterThan(0)
    expect(result.content).toContain('检查并确认')
    expect(db.db.prepare('SELECT count(*) AS count FROM task_status').get()!.count).toBe(0)
  })

  it('does not trust model-provided source fields when constructing a draft', async () => {
    const result = await executeTool(env, admin, 'prepare_notice_draft', { title: '标题', content: '伪造内容', sourceDate: '2000-01-01', tasks: [{ title: '提交材料', description: '', dueAt: null, audience: 'all', memberIds: [] }] }, { message: '来自本次用户消息的原文', sourceDate: '2026-10-08' })
    expect(result).toMatchObject({ payload: { content: '来自本次用户消息的原文', sourceDate: '2026-10-08' } })
  })
})
