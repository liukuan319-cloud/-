export interface Session {
  user: { id: string; nickname: string; role: 'admin' | 'student'; classId: string }
  classroom: { id: string; name: string; inviteCode?: string; isDemo: boolean }
  mode: 'demo' | 'live' | 'unconfigured'
  recoveryCode?: string
}
export interface Task { id: string; noticeId: string; title: string; description: string; dueAt: string | null; status: 'pending' | 'completed'; version: number; noticeTitle: string; audience: 'all' | 'selected' }
export interface Notice { id: string; title: string; content: string; sourceDate: string; createdAt: string; updatedAt: string; version: number; status: 'published' | 'withdrawn'; authorName: string }
export interface Member { id: string; nickname: string; role: string; status?: string }
export interface DraftTask { title: string; description: string; dueAt: string | null; audience: 'all' | 'selected'; memberIds: string[] }
export interface Draft { title: string; content: string; sourceDate: string; tasks: DraftTask[] }
export interface Action { id: string; type: string; payload: Record<string, unknown>; expiresAt?: string }
export interface ChatCard { type: string; [key: string]: unknown }
export interface Message { id: string; role: 'user' | 'assistant'; content: string; cards?: ChatCard[]; createdAt?: string }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } })
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string }
  if (!response.ok) throw new Error(body.error || body.message || `请求失败（${response.status}）`)
  return body as T
}
export const post = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) })

export function formatDate(date: string | null, short = false) {
  if (!date) return '截止时间待确认'
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return '截止时间待确认'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', ...(short ? {} : { hour: '2-digit', minute: '2-digit' }) }).format(parsed)
}
export function overdue(task: Task) { return task.status !== 'completed' && !!task.dueAt && new Date(task.dueAt).getTime() < Date.now() }
export function beijingInput(date: string | null) {
  if (!date) return ''
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Date(parsed.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)
}
export function beijingISOString(value: string): string | null {
  if (!value) return null
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/)
  if (!match) throw new Error('请输入有效的日期和时间。')
  const iso = `${match[1]}T${match[2]}:${match[3] || '00'}+08:00`
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime()) || beijingInput(iso) !== `${match[1]}T${match[2]}`) throw new Error('请输入有效的日期和时间。')
  return iso
}
