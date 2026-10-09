import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowRight, ArrowUp, Bell, BookOpen, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Clock3, Copy, FileText, LayoutDashboard, Leaf, ListTodo, LoaderCircle, LogOut, Menu, MessageCircle, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Users, WandSparkles, X } from 'lucide-react'
import { api, post, formatDate, overdue, beijingInput, beijingISOString } from './api'
import type { Action, ChatCard, Draft, DraftTask, Member, Message, Notice, Session, Task } from './api'
import { BRAND } from './config'

type Page = 'ai' | 'tasks' | 'notices' | 'admin' | 'settings'
const nav = [{ id: 'ai', name: 'AI 助手', icon: MessageCircle }, { id: 'tasks', name: '我的待办', icon: ListTodo }, { id: 'notices', name: '班级通知', icon: Bell }, { id: 'admin', name: '发布与统计', icon: LayoutDashboard }, { id: 'settings', name: '班级与设置', icon: Settings2 }] as const
const uid = () => crypto.randomUUID()
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const blankTask = (): DraftTask => ({ title: '', description: '', dueAt: null, audience: 'all', memberIds: [] })
const blankDraft = (): Draft => ({ title: '', content: '', sourceDate: today(), tasks: [blankTask()] })

function Button({ children, busy, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'ghost' | 'outline' | 'danger' }) {
  return <button {...props} className={`btn ${variant} ${props.className || ''}`} disabled={props.disabled || busy}>{busy && <LoaderCircle size={16} className="spin" />}{children}</button>
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const node = ref.current; node?.showModal(); return () => node?.close() }, [])
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }}><div className="modal-head"><h2>{title}</h2><button className="icon-btn" aria-label="关闭窗口" onClick={onClose}><X size={20} /></button></div>{children}</dialog>
}
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><Leaf size={32} /><h3>{title}</h3><p>{text}</p></div> }

function DueDateInput({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const [local, setLocal] = useState(() => beijingInput(value))
  useEffect(() => setLocal(beijingInput(value)), [value])
  return <input type="datetime-local" step="60" value={local} onInput={e => {
    const node = e.currentTarget
    setLocal(node.value)
    try { const iso = beijingISOString(node.value); node.setCustomValidity(''); onChange(iso) }
    catch (error) { node.setCustomValidity((error as Error).message) }
  }} />
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const [page, setPage] = useState<Page>('ai')
  const [collapsed, setCollapsed] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [selectedNotice, setSelectedNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [transferredDraft, setTransferredDraft] = useState<Draft | null>(null)
  const [confirming, setConfirming] = useState(false)
  const refreshRunning = useRef(false)
  const identityRef = useRef<string | undefined>(undefined)
  identityRef.current = session?.user.id

  useEffect(() => { api<Session>('/session').then(setSession).catch(() => {}).finally(() => setBooting(false)) }, [])
  useEffect(() => {
    if (!session) return
    void refresh(true)
    const sync = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    const timer = window.setInterval(sync, 15000)
    return () => { window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); window.clearInterval(timer) }
  }, [session?.user.id])
  useEffect(() => { if (toast) { const t = window.setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])

  async function refresh(showLoading = false) {
    if (refreshRunning.current) return
    const memberId = identityRef.current
    refreshRunning.current = true
    if (showLoading) setLoading(true)
    try {
      const [t, n] = await Promise.all([api<{ tasks: Task[] }>('/tasks'), api<{ notices: Notice[] }>('/notices')])
      if (identityRef.current === memberId) { setTasks(t.tasks); setNotices(n.notices) }
    } catch (e) { if (identityRef.current === memberId && showLoading) setError((e as Error).message) }
    finally { refreshRunning.current = false; if (showLoading) setLoading(false) }
  }
  function signedIn(value: Session) { setSession(value); setPage('ai') }
  async function logout() { try { await api('/session', { method: 'DELETE' }); setSession(null); setTasks([]); setNotices([]) } catch (e) { setError((e as Error).message) } }
  async function prepareTask(task: Task) {
    try {
      const latest = await api<{ tasks: Task[] }>('/tasks')
      setTasks(latest.tasks)
      const current = latest.tasks.find(t => t.id === task.id)
      if (!current) throw new Error('这项任务已撤回或不再对你开放。')
      if (current.status !== task.status) throw new Error('任务状态已更新，请检查最新状态后再操作。')
      const res = await post<{ action: Action }>('/actions', { type: 'task_status', taskId: current.id, status: current.status === 'completed' ? 'pending' : 'completed', version: current.version })
      setPending(res.action)
    }
    catch (e) { setError((e as Error).message) }
  }
  async function confirmAction() {
    if (!pending) return
    setConfirming(true)
    try { await post(`/actions/${pending.id}/confirm`, {}); setPending(null); setToast('已更新，班级进度已同步'); await refresh() }
    catch (e) { setError((e as Error).message) } finally { setConfirming(false) }
  }
  function showNotice(id: string) { const notice = notices.find(n => n.id === id); if (notice) setSelectedNotice(notice); else api<{ notice: Notice }>(`/notices/${id}`).then(v => setSelectedNotice(v.notice)).catch(e => setError(e.message)) }
  const remaining = tasks.filter(t => t.status === 'pending').length
  const completed = tasks.length - remaining
  if (booting) return <div className="boot"><Brand /><LoaderCircle className="spin" /><span>正在准备你的班级空间…</span></div>
  if (!session) return <Welcome onSignIn={signedIn} />
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar">
      <Brand compact={collapsed} /><button className="collapse-button icon-btn" aria-label={collapsed ? '展开导航' : '收起导航'} onClick={() => setCollapsed(!collapsed)}><Menu size={17} /></button>
      <div className="class-switch"><span className="class-icon"><BookOpen size={19} /></span><div><strong>{session.classroom.name}</strong><small>{session.classroom.isDemo ? '示例班级 · 独立演示空间' : '我们的班级空间'}</small></div><ChevronDown size={16} /></div>
      <p className="nav-caption">我的工作台</p>
      <nav aria-label="主导航">{nav.filter(n => n.id !== 'admin' || session.user.role === 'admin').map(({ id, name, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)} title={name}><Icon size={19} /><span>{name}</span>{id === 'tasks' && remaining > 0 && <b>{remaining}</b>}{id === 'ai' && <span className="tiny-spark"><Sparkles size={13} /></span>}</button>)}</nav>
      <div className="sidebar-note"><div className="small-icon"><Leaf size={19} /></div><h4>班务小事，交给 AI</h4><p>让每一条重要通知<br />都成为清晰的下一步。</p><span>有来源 · 可确认 · 可追踪</span></div>
      <button className="user-profile" onClick={() => setPage('settings')}><span className="avatar">{session.user.nickname.slice(-2)}</span><span><strong>{session.user.nickname}</strong><small>{session.user.role === 'admin' ? '班级管理员' : '班级成员'}</small></span><Settings2 size={17} /></button>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">我的工作台 <ChevronRight size={14} /><strong>{nav.find(n => n.id === page)?.name}</strong></div><div className="topbar-right"><span className={`mode-pill ${session.mode === 'live' ? 'live' : ''}`}><span />{session.mode === 'demo' ? '示例演示' : session.mode === 'live' ? 'AI 已配置' : 'AI 待配置'}</span><span className="date-label"><CalendarDays size={15} />{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Shanghai' }).format(new Date())}</span><button className="icon-btn" aria-label="查看通知" onClick={() => setPage('notices')}><Bell size={19} /></button></div></header>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div>}
      <main className="main-content">
        {page === 'ai' && <ChatView session={session} tasks={tasks} loading={loading} onTask={prepareTask} onNotice={showNotice} onPage={setPage} onAction={setPending} onDraft={value => { setTransferredDraft(value); setPage('admin') }} onRefresh={refresh} />}
        {page === 'tasks' && <TasksPage tasks={tasks} loading={loading} onTask={prepareTask} onNotice={showNotice} />}
        {page === 'notices' && <NoticesPage notices={notices} loading={loading} onNotice={setSelectedNotice} />}
        {page === 'admin' && session.user.role === 'admin' && <AdminPage initialDraft={transferredDraft} onConsumeDraft={() => setTransferredDraft(null)} tasks={tasks} notices={notices} onRefresh={refresh} onNotice={setSelectedNotice} onError={setError} />}
        {page === 'settings' && <SettingsPage session={session} tasks={tasks} completed={completed} onLogout={logout} onSession={setSession} onNotify={setToast} onError={setError} onAdmin={() => setPage('admin')} />}
      </main>
      <footer className="page-footer"><ShieldCheck size={13} />回答有来源，操作由你确认<span>与你一起，把班级事务变简单</span></footer>
    </div>
    <nav className="mobile-nav" aria-label="手机导航">{nav.filter(n => n.id !== 'admin').map(({ id, name, icon: Icon }) => <button className={page === id ? 'active' : ''} key={id} onClick={() => setPage(id)}><Icon size={20} /><span>{id === 'settings' ? '我的' : name}</span></button>)}</nav>
    {toast && <div className="toast" role="status"><CheckCheck size={18} />{toast}</div>}

    {selectedNotice && <Modal title="通知详情" onClose={() => setSelectedNotice(null)}><div className="notice-modal"><span className="eyebrow">班级通知 / 原始来源</span><h1>{selectedNotice.title}</h1><p className="muted">{selectedNotice.authorName} · {formatDate(selectedNotice.createdAt)}{selectedNotice.version > 1 && ' · 已更新'}</p><div className="notice-content">{selectedNotice.content}</div><div className="source-note"><ShieldCheck size={16} />AI 回答以这条通知为依据。时间均为北京时间。</div></div></Modal>}
    {pending && <Modal title="确认你的操作" onClose={() => setPending(null)}><div className="confirm-body"><span className="confirm-icon"><CheckCheck size={28} /></span><h3>{pending.payload.status === 'pending' ? '将任务改回待完成？' : '确认已完成这项任务？'}</h3><p>{String(pending.payload.taskTitle || pending.payload.title || '请确认任务内容后再操作。')}</p><p className="muted">完成状态为本人自报，不代表已核验提交文件。你可以稍后撤销。</p><div className="button-row"><Button variant="outline" onClick={() => setPending(null)}>再检查一下</Button><Button busy={confirming} onClick={confirmAction}>确认更新 <Check size={16} /></Button></div></div></Modal>}
  </div>
}

function Brand({ compact = false }: { compact?: boolean }) { return <div className="brand"><div className="brand-mark"><Sparkles size={23} strokeWidth={1.8} /></div>{!compact && <div><strong>{BRAND.name}</strong><small>CLASSROOM, CONNECTED.</small></div>}</div> }
function Welcome({ onSignIn }: { onSignIn: (s: Session) => void }) {
  const [mode, setMode] = useState<'join' | 'create'>('join')
  const [identifierKind, setIdentifierKind] = useState<'nickname' | 'studentNo'>('nickname')
  const [nickname, setNickname] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  async function submit(e: FormEvent) { e.preventDefault(); setBusy('form'); setError(''); try { onSignIn(await post<Session>(mode === 'join' ? '/join' : '/classes', mode === 'join' ? { inviteCode: value, [identifierKind]: nickname } : { name: value, nickname })) } catch (e) { setError((e as Error).message) } finally { setBusy('') } }
  async function demo(role: 'admin' | 'student') { setBusy(role); setError(''); try { onSignIn(await post<Session>('/demo', { role })) } catch (e) { setError((e as Error).message) } finally { setBusy('') } }
  return <div className="welcome"><header><Brand /><span className="welcome-label"><Leaf size={15} />为更从容的班级生活而设计</span></header><main className="welcome-main"><section className="welcome-copy"><span className="eyebrow"><span className="green-dot" />你的班级，现在更有条理</span><h1>班级大小事，<br />问一句<span className="hand-underline">就清楚。</span></h1><p>通知不用翻，待办不再漏。<br />让 AI 帮你理清每一件事，把时间留给更重要的事。</p><div className="welcome-feature"><span><ShieldCheck size={17} />回答有来源</span><span><CheckCheck size={17} />操作可确认</span><span><ClipboardList size={17} />进度可追踪</span></div><div className="preview-bubble"><div className="mini-ai"><Sparkles size={20} /></div><div><strong>“这周还有什么要交？”</strong><p>帮你查清截止时间、提交要求和原始通知。</p></div><ArrowRight size={19} /></div><div className="welcome-stamp"><div className="stamp-avatars"><i>林</i><i>陈</i><i>李</i></div><span>让班干部和同学，都少一点琐碎。</span></div></section><section className="entry-card"><div className="entry-leaf"><Leaf size={24} /></div><h2>{mode === 'join' ? '欢迎来到班级空间' : '创建我们的班级'}</h2><p className="muted">从一条通知开始，让每件小事都有着落。</p><div className="entry-tabs">{([{ id: 'join', text: '加入班级' }, { id: 'create', text: '创建班级' }] as const).map(t => <button key={t.id} className={mode === t.id ? 'active' : ''} onClick={() => { setMode(t.id); setValue(''); setError('') }}>{t.text}</button>)}</div><form onSubmit={submit}>{mode === 'join' && <label>登录方式<select value={identifierKind} onChange={e=>{setIdentifierKind(e.target.value as 'nickname'|'studentNo');setNickname('')}}><option value="nickname">姓名</option><option value="studentNo">学号</option></select></label>}<label>{mode === 'join' ? (identifierKind === 'studentNo' ? '你的学号' : '你的姓名') : '你的姓名'}<input required maxLength={mode==='join'&&identifierKind==='studentNo'?64:24} autoComplete="off" placeholder={identifierKind==='studentNo'&&mode==='join'?'名单中的学号':'名单中的姓名'} value={nickname} onChange={e=>setNickname(e.target.value)} /></label><label>{mode==='join'?'班级邀请码':'班级名称'}<input required maxLength={80} autoComplete="off" placeholder={mode==='join'?'向班干部获取邀请码':'例如：2026 级计算机 1 班'} value={value} onChange={e=>setValue(e.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" busy={busy==='form'} disabled={!!busy} className="full-width">{mode==='join'?'进入班级':'创建班级空间'}<ArrowRight size={17}/></Button></form><div className="divider"><span>想先了解一下？</span></div><div className="demo-buttons"><Button variant="outline" busy={busy === 'student'} disabled={!!busy} onClick={() => demo('student')}><Users size={16} />同学视角</Button><Button variant="outline" busy={busy === 'admin'} disabled={!!busy} onClick={() => demo('admin')}><WandSparkles size={16} />班干部视角</Button></div><p className="entry-hint">示例体验使用独立数据，未调用真实模型。</p></section></main><footer><span>© {new Date().getFullYear()} {BRAND.name}</span><span>让通知成为行动，让班级更有温度。</span></footer></div>
}

function ChatView({ session, tasks, loading, onTask, onNotice, onPage, onAction, onDraft, onRefresh }: { session: Session; tasks: Task[]; loading: boolean; onTask: (t: Task) => void; onNotice: (id: string) => void; onPage: (p: Page) => void; onAction: (a: Action) => void; onDraft: (draft: Draft) => void; onRefresh: () => Promise<void> }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sourceDate, setSourceDate] = useState(today())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const pendingTasks = tasks.filter(t => t.status === 'pending')
  useEffect(() => { api<{ messages: Message[] }>('/chat').then(v => setMessages(v.messages)).catch(() => {}) }, [session.user.id])
  useEffect(() => { if (messages.length) end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages.length, busy])
  async function send(text: string) {
    if (!text.trim() || busy) return
    setInput(''); setError(''); setBusy(true); setStatus('正在理解你的问题…')
    const userMessage: Message = { id: uid(), role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMessage])
    try {
      const response = await fetch('/api/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text.trim(), sourceDate }) })
      if (!response.ok) { const data = await response.json() as { error?: string }; throw new Error(data.error || '暂时无法连接 AI，请稍后重试。') }
      if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
        const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = ''; let answer: Message | null = null
        while (true) {
          const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const chunks = buffer.split('\n\n'); buffer = chunks.pop() || ''
          for (const chunk of chunks) { const kind = chunk.match(/^event:\s*(.*)$/m)?.[1]; const raw = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n'); if (!raw) continue; const data = JSON.parse(raw) as Record<string, unknown>; if (kind === 'status') setStatus(String(data.message || data.text || '正在处理…')); if (kind === 'error') throw new Error(String(data.message || data.error || 'AI 暂时不可用')); if (kind === 'message' || kind === 'result' || kind === 'done') { const result = (data.message && typeof data.message === 'object' ? data.message : data) as unknown as Message; if (result.content) answer = { ...result, id: result.id || uid(), role: 'assistant' } } }
        }
        if (answer) setMessages(prev => [...prev, answer!]); else { const history = await api<{ messages: Message[] }>('/chat'); setMessages(history.messages) }
      } else { const data = await response.json() as { message?: Message; content?: string; cards?: ChatCard[] }; const msg = data.message || { id: uid(), role: 'assistant' as const, content: data.content || '', cards: data.cards }; setMessages(prev => [...prev, msg]) }
      await onRefresh()
    } catch (e) { setError((e as Error).message); setInput(text) } finally { setBusy(false); setStatus('') }
  }
  return <div className="ai-layout"><section className="chat-column"><div className="greeting-row"><div><span className="eyebrow">YOUR CLASS, A LITTLE SIMPLER</span><h1>你好，{session.user.nickname}<span className="wave">☀</span></h1><p>今天也一起，把班级的事安排好。</p></div><div className="greeting-decoration"><Leaf size={40} strokeWidth={1.1} /><span /></div></div><button className="mobile-task-summary" onClick={() => onPage('tasks')}><ListTodo size={17} />还有 <strong>{pendingTasks.length}</strong> 项待办，今天也有条不紊<ChevronRight size={16} /></button><div className="conversation-panel"><div className="conversation-heading"><div className="ai-avatar"><Sparkles size={21} /></div><div><strong>你的班级 AI 助手</strong><span><span className="green-dot" />{session.mode === 'live' ? '随时帮你理清班务' : session.mode === 'demo' ? '示例演示 · 未调用真实模型' : '配置模型后即可开启真实 AI'}</span></div><span className="beta-pill">AI</span></div><div className="conversation-body">
      {messages.length === 0 ? <div className="chat-welcome"><div className="orb"><Sparkles size={34} strokeWidth={1.4} /><span className="orb-star">✧</span></div><h2>班务有点多？<br /><span>从问我一句开始。</span></h2><p>找通知、查待办、跟进完成情况。<br />我帮你找到答案，也把下一步准备好。</p><div className="prompt-grid">{[{ icon: ListTodo, title: '看看我的待办', text: '我今天需要做什么？', color: 'mint' }, { icon: Search, title: '找一条班级通知', text: '帮我找运动会报名要求', color: 'blue' }, { icon: CalendarDays, title: '安排这周的事', text: '这周有什么要交？', color: 'peach' }, { icon: CheckCheck, title: session.user.role === 'admin' ? '了解班级进度' : '更新任务状态', text: session.user.role === 'admin' ? '运动会报名还有谁没完成？' : '我已经完成运动会报名', color: 'purple' }].map(p => <button key={p.title} className="prompt-card" onClick={() => send(p.text)}><span className={`prompt-icon ${p.color}`}><p.icon size={18} /></span><strong>{p.title}</strong><small>{p.text}</small><ArrowUp size={15} /></button>)}</div></div> : <div className="message-list">{messages.map(m => <div key={m.id} className={`message ${m.role}`}><span className={m.role === 'assistant' ? 'mini-ai' : 'avatar'}>{m.role === 'assistant' ? <Sparkles size={17} /> : session.user.nickname.slice(-1)}</span><div className="message-main"><span className="message-name">{m.role === 'assistant' ? BRAND.name : session.user.nickname}</span><div className="message-content">{m.content}</div>{m.cards?.map((card, i) => <ResultCard key={i} card={card} tasks={tasks} onTask={onTask} onNotice={onNotice} onAction={onAction} onPage={onPage} onDraft={onDraft} />)}</div></div>)}<div ref={end} /></div>}
      {busy && <div className="thinking"><LoaderCircle size={15} className="spin" />{status}</div>}{error && <p className="chat-error" role="alert">{error} 输入已保留，可重新发送。</p>}</div><form className="composer" onSubmit={e => { e.preventDefault(); void send(input) }}><textarea aria-label="向班级 AI 提问" placeholder="问问班级的事，或者粘贴一条通知…" value={input} maxLength={12000} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input) } }} rows={2} /><div className="composer-bottom">{session.user.role === 'admin' && <label className="source-date">原通知日期<input type="date" aria-label="原通知日期" value={sourceDate} onChange={e => setSourceDate(e.target.value)} /></label>}<span><ShieldCheck size={14} />重要操作会先请你确认</span><span className="enter-hint">Enter 发送 · Shift + Enter 换行</span><button className="send-button" type="submit" disabled={busy || !input.trim()} aria-label="发送消息">{busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={20} />}</button></div></form><div className="chat-disclaimer">{session.mode === 'demo' ? '当前为规则示例体验，仅支持部分班务问题。' : 'AI 可能遗漏细节，请以原始通知和确认页面为准。'}<button onClick={() => onPage('settings')}>了解更多<CircleHelp size={12} /></button></div></div></section>
    <aside className="right-panel"><div className="today-card"><div className="section-top"><h3><span className="green-dot" />我的待办</h3><button className="text-link" onClick={() => onPage('tasks')}>查看全部<ArrowRight size={14} /></button></div><div className="task-count"><strong>{pendingTasks.length.toString().padStart(2, '0')}</strong><div>件事等你完成<br /><small>{tasks.filter(t => t.status === 'completed').length} 件已经完成，继续加油</small></div></div><div className="mini-task-list">{loading ? <Skeleton /> : pendingTasks.slice(0, 3).map(t => <div className="mini-task" key={t.id}><button className="check-circle" aria-label={`完成${t.title}`} onClick={() => onTask(t)} /><div><button className="plain-title" onClick={() => onNotice(t.noticeId)}>{t.title}</button><span className={overdue(t) ? 'due overdue' : 'due'}><Clock3 size={12} />{overdue(t) ? '已逾期 · ' : ''}{formatDate(t.dueAt)}</span></div></div>)}{!loading && pendingTasks.length === 0 && <p className="muted all-done">都完成啦，享受一点轻松时刻 🌿</p>}</div><div className="progress-label"><span>我的完成进度</span><strong>{tasks.length ? Math.round((tasks.length - pendingTasks.length) / tasks.length * 100) : 0}%</strong></div><div className="progress-track"><span style={{ width: `${tasks.length ? (tasks.length - pendingTasks.length) / tasks.length * 100 : 0}%` }} /></div></div><div className="quick-card"><h3>班级快捷入口</h3><button onClick={() => onPage('notices')}><span className="quick-icon"><FileText size={18} /></span><span><strong>全部通知</strong><small>每一条消息，都找得到</small></span><ChevronRight size={16} /></button><button onClick={() => onPage(session.user.role === 'admin' ? 'admin' : 'settings')}><span className="quick-icon peach"><Users size={18} /></span><span><strong>{session.user.role === 'admin' ? '发布与统计' : '我的班级'}</strong><small>{session.user.role === 'admin' ? '把通知整理成下一步' : session.classroom.name}</small></span><ChevronRight size={16} /></button></div><div className="tip-card"><span className="tip-spark">✧</span><span className="eyebrow">A LITTLE TIP</span><h3>问得自然一点，<br />也没关系。</h3><p>试试说“这周有什么要交？”<br />不需要记住复杂的菜单，<br />从你的问题开始就好。</p><span className="tip-leaf"><Leaf size={58} strokeWidth={1} /></span></div><div className="right-bottom"><ShieldCheck size={15} /><span>班级数据，仅对授权成员可见</span></div></aside></div>
}

function ResultCard({ card, tasks, onTask, onNotice, onAction, onPage, onDraft }: { card: ChatCard; tasks: Task[]; onTask: (t: Task) => void; onNotice: (id: string) => void; onAction: (a: Action) => void; onPage: (p: Page) => void; onDraft: (draft: Draft) => void }) {
  const list = Array.isArray(card.tasks) ? card.tasks as Task[] : card.task ? [card.task as Task] : []
  const action = (card.action || (card.type === 'action' ? card : null)) as Action | null
  if (card.type === 'draft' || action?.type === 'publish_notice') return <div className="result-card"><FileText size={18} /><strong>通知草稿已准备好</strong><p>请到发布与统计中检查原文、日期和接收人后发布。</p><Button variant="outline" onClick={() => { if (action?.payload) onDraft(action.payload as unknown as Draft); else onPage('admin') }}>检查通知草稿<ArrowRight size={15} /></Button></div>
  if (action?.id) return <div className="result-card"><CheckCheck size={19} /><strong>操作待你确认</strong><p>{String(action.payload?.taskTitle || action.payload?.title || '请检查任务信息后确认更新。')}</p><Button onClick={() => onAction(action)}>查看并确认</Button></div>
  if (list.length) return <div className="result-tasks">{list.map(t => { const current = tasks.find(task => task.id === t.id); return current ? <TaskCard key={t.id} task={current} onTask={onTask} onNotice={onNotice} /> : <div key={t.id} className="result-card"><strong>{t.title}</strong><p>历史任务已撤回或不再对你开放，请以当前待办为准。</p></div> })}</div>
  const noticeList = Array.isArray(card.notices) ? card.notices as Notice[] : card.notice ? [card.notice as Notice] : []
  if (noticeList.length) return <div className="result-card">{noticeList.map(n => <button key={n.id} className="source-link" onClick={() => onNotice(n.id)}><FileText size={15} />{n.title}<ArrowRight size={14} /></button>)}</div>
  if (card.noticeId) return <button className="source-link" onClick={() => onNotice(String(card.noticeId))}><FileText size={15} />{String(card.title || '查看原始通知')}<ArrowRight size={14} /></button>
  if (card.type === 'progress') { const p = (card.progress || card) as { total?: number; completed?: number; members?: Member[] }; return <div className="result-card"><strong>完成进度 {p.completed ?? 0}/{p.total ?? 0}</strong><p>{p.members?.filter(m => m.status !== 'completed').map(m => m.nickname).join('、') || '暂无未完成人员'}</p><small>完成状态由同学自报。</small></div> }
  return null
}
function Skeleton() { return <div aria-label="加载中" className="skeleton-stack">{[1, 2, 3].map(i => <div className="skeleton" key={i} />)}</div> }
function PageHeading({ eyebrow, title, text, children }: { eyebrow: string; title: string; text: string; children?: ReactNode }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{children}</div> }
function TaskCard({ task, onTask, onNotice }: { task: Task; onTask: (t: Task) => void; onNotice: (id: string) => void }) { return <article className={`task-card ${task.status === 'completed' ? 'completed' : ''}`}><button className={`check-circle ${task.status === 'completed' ? 'checked' : ''}`} aria-label={task.status === 'completed' ? `撤销完成${task.title}` : `完成${task.title}`} onClick={() => onTask(task)}>{task.status === 'completed' && <Check size={15} />}</button><div className="task-card-body"><div className="task-title-line"><h3>{task.title}</h3><span className={`task-badge ${overdue(task) ? 'late' : task.status === 'completed' ? 'done' : ''}`}>{task.status === 'completed' ? '已完成' : overdue(task) ? '已逾期' : '待完成'}</span></div><p>{task.description}</p><div className="task-meta"><span className={overdue(task) ? 'overdue' : ''}><Clock3 size={14} />{formatDate(task.dueAt)}</span><button onClick={() => onNotice(task.noticeId)}><FileText size={14} />原始通知</button>{task.dueAt && <a href={`/api/tasks/${task.id}/calendar.ics`} download><CalendarDays size={14} />加入日历</a>}</div></div></article> }
function TasksPage({ tasks, loading, onTask, onNotice }: { tasks: Task[]; loading: boolean; onTask: (t: Task) => void; onNotice: (id: string) => void }) {
  const [filter, setFilter] = useState('pending')
  const visible = tasks.filter(t => filter === 'all' || (filter === 'overdue' ? overdue(t) : t.status === filter))
  return <div className="standard-page"><PageHeading eyebrow="ONE THING AT A TIME" title="我的待办" text="每完成一件小事，就多一份从容。" /><div className="summary-grid"><div><span>待我完成</span><strong>{tasks.filter(t => t.status === 'pending').length}<small>项</small></strong></div><div><span>已经完成</span><strong>{tasks.filter(t => t.status === 'completed').length}<small>项</small></strong></div><div><span>需要留意</span><strong className="overdue">{tasks.filter(overdue).length}<small>项逾期</small></strong></div></div><div className="tab-row">{[{ id: 'pending', name: '待完成' }, { id: 'completed', name: '已完成' }, { id: 'overdue', name: '已逾期' }, { id: 'all', name: '全部' }].map(t => <button key={t.id} className={filter === t.id ? 'active' : ''} onClick={() => setFilter(t.id)}>{t.name}</button>)}</div>{loading ? <Skeleton /> : visible.length ? <div className="task-list">{visible.map(t => <TaskCard key={t.id} task={t} onTask={onTask} onNotice={onNotice} />)}</div> : <Empty title="这里暂时没有待办" text="新任务发布后会出现在这里，你也可以问问 AI。" />}<p className="small-footnote"><ShieldCheck size={14} />完成状态由你本人反馈，可随时撤销。截止时间均为北京时间。</p></div>
}
function NoticesPage({ notices, loading, onNotice }: { notices: Notice[]; loading: boolean; onNotice: (n: Notice) => void }) { const [search, setSearch] = useState(''); const filtered = notices.filter(n => n.status === 'published' && `${n.title} ${n.content}`.includes(search)); return <div className="standard-page"><PageHeading eyebrow="EVERY MESSAGE MATTERS" title="班级通知" text="不再翻聊天记录，重要消息都在这里。" /><div className="search-field"><Search size={19} /><input aria-label="搜索通知" value={search} placeholder="搜索通知标题或内容…" onChange={e => setSearch(e.target.value)} /><span>{filtered.length} 条通知</span></div>{loading ? <Skeleton /> : filtered.length ? <div className="notice-grid">{filtered.map((n, i) => <button className="notice-card" key={n.id} onClick={() => onNotice(n)}><div className="notice-card-top"><span className={`notice-icon ${i % 2 ? 'peach' : ''}`}><FileText size={21} /></span><span className="notice-type">班级通知{n.version > 1 && ' · 已更新'}</span><ArrowUp size={17} /></div><h3>{n.title}</h3><p>{n.content}</p><div className="notice-card-footer"><span>{n.authorName}</span><span>{formatDate(n.createdAt, true)}</span></div></button>)}</div> : <Empty title={search ? '还没有找到这条通知' : '我们的第一条通知，等你发布'} text={search ? '换个关键词试试，或直接向 AI 提问。' : '班干部发布后，全班都能在这里查看。'} />}</div> }

function AdminPage({ initialDraft, onConsumeDraft, tasks, notices, onRefresh, onNotice, onError }: { initialDraft: Draft | null; onConsumeDraft: () => void; tasks: Task[]; notices: Notice[]; onRefresh: () => Promise<void>; onNotice: (n: Notice) => void; onError: (e: string) => void }) {
  useEffect(() => { onConsumeDraft() }, [])
  const [tab, setTab] = useState<'publish' | 'progress'>('publish')
  const [draft, setDraft] = useState<Draft>(() => initialDraft || blankDraft())
  const [members, setMembers] = useState<Member[]>([])
  const [adminTasks, setAdminTasks] = useState<Task[]>(tasks)
  const [busy, setBusy] = useState(false)
  const [reviewAction, setReviewAction] = useState<Action | null>(null)
  const [published, setPublished] = useState(false)
  const [progress, setProgress] = useState<{ task: Task; total: number; completed: number; members: Member[] } | null>(null)
  const [edit, setEdit] = useState<Notice | null>(null)
  const [withdraw, setWithdraw] = useState<Notice | null>(null)
  useEffect(() => {
    if (!progress) return
    let cancelled = false
    api<{ total: number; completed: number; members: Member[] }>(`/tasks/${progress.task.id}/progress`)
      .then(value => { if (!cancelled) setProgress(previous => previous ? { task: previous.task, ...value } : null) })
      .catch(() => { if (!cancelled) setProgress(null) })
    return () => { cancelled = true }
  }, [tasks, tab, progress?.task.id])
  useEffect(() => { api<{ members: Member[] }>('/members').then(v => setMembers(v.members)).catch(() => {}) }, [])
  useEffect(() => { api<{ tasks: Task[] }>('/admin/tasks').then(v => setAdminTasks(v.tasks)).catch(() => {}) }, [tasks, tab])
  function updateTask(index: number, value: Partial<DraftTask>) { setDraft(prev => ({ ...prev, tasks: prev.tasks.map((t, i) => i === index ? { ...t, ...value } : t) })); setReviewAction(null) }
  async function prepare(e: FormEvent) { e.preventDefault(); setBusy(true); setPublished(false); try { const v = await post<{ action: Action }>('/drafts', draft); setReviewAction(v.action) } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function publish() { if (!reviewAction) return; setBusy(true); try { await post(`/actions/${reviewAction.id}/confirm`, { draft }); setReviewAction(null); setPublished(true); setDraft(blankDraft()); await onRefresh() } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function viewProgress(task: Task) { try { const v = await api<{ total: number; completed: number; members: Member[] }>(`/tasks/${task.id}/progress`); setProgress({ task, ...v }) } catch (e) { onError((e as Error).message) } }
  async function saveNotice() { if (!edit) return; setBusy(true); try { await api(`/notices/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ title: edit.title, content: edit.content, version: edit.version }) }); setEdit(null); await onRefresh() } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function withdrawNotice() { if (!withdraw) return; setBusy(true); try { await api(`/notices/${withdraw.id}`, { method: 'DELETE', body: JSON.stringify({ version: withdraw.version }) }); setWithdraw(null); await onRefresh() } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  return <div className="standard-page"><PageHeading eyebrow="LESS ADMIN, MORE CONNECTION" title="发布与统计" text="把一条通知，变成全班清晰的下一步。" /><div className="tab-row"><button className={tab === 'publish' ? 'active' : ''} onClick={() => setTab('publish')}>整理并发布</button><button className={tab === 'progress' ? 'active' : ''} onClick={() => setTab('progress')}>完成统计与通知管理</button></div>{published && <div className="success-banner"><CheckCheck size={18} />通知已发布，接收同学可以查看关联待办。</div>}{tab === 'publish' ? <form className="editor-panel" onSubmit={prepare}><div className="editor-heading"><span className="step-bubble">1</span><div><h3>保留原文，理清重点</h3><p>可先在 AI 助手中整理通知，也可以在这里手动填写。</p></div></div><div className="form-grid"><label>通知标题<input required maxLength={120} value={draft.title} onChange={e => { setDraft({ ...draft, title: e.target.value }); setReviewAction(null) }} placeholder="例如：秋季运动会报名通知" /></label><label>原通知日期<input type="date" required value={draft.sourceDate.slice(0, 10)} onChange={e => { setDraft({ ...draft, sourceDate: e.target.value }); setReviewAction(null) }} /></label></div><label>原始通知<textarea required rows={5} maxLength={12000} value={draft.content} onChange={e => { setDraft({ ...draft, content: e.target.value }); setReviewAction(null) }} placeholder="粘贴脱敏后的原通知。请保留提交要求和时间信息。" /></label><div className="editor-heading spaced"><span className="step-bubble">2</span><div><h3>检查任务与接收人</h3><p>不明确的日期请先核对。没有截止日期可以留空。</p></div></div>{draft.tasks.map((t, index) => <div className="draft-task" key={index}><div className="draft-task-top"><strong>任务 {index + 1}</strong>{draft.tasks.length > 1 && <button type="button" className="text-link" onClick={() => { setDraft({ ...draft, tasks: draft.tasks.filter((_, i) => i !== index) }); setReviewAction(null) }}>移除<X size={13} /></button>}</div><label>要完成的事<input required value={t.title} maxLength={120} onChange={e => updateTask(index, { title: e.target.value })} placeholder="例如：提交运动会报名表" /></label><label>任务要求<textarea rows={2} maxLength={4000} value={t.description} onChange={e => updateTask(index, { description: e.target.value })} placeholder="在哪里提交？需要准备什么？" /></label><div className="form-grid"><label>截止时间（北京时间）<DueDateInput value={t.dueAt} onChange={dueAt => updateTask(index, { dueAt })} /></label><label>接收范围<select value={t.audience} onChange={e => updateTask(index, { audience: e.target.value as 'all' | 'selected', memberIds: [] })}><option value="all">全班同学</option><option value="selected">指定成员</option></select></label></div>{t.audience === 'selected' && <div className="member-picker">{members.map(m => <label key={m.id}><input type="checkbox" checked={t.memberIds.includes(m.id)} onChange={e => updateTask(index, { memberIds: e.target.checked ? [...t.memberIds, m.id] : t.memberIds.filter(id => id !== m.id) })} />{m.nickname}</label>)}</div>}</div>)}<Button type="button" variant="outline" disabled={draft.tasks.length >= 12} onClick={() => { setDraft({ ...draft, tasks: [...draft.tasks, blankTask()] }); setReviewAction(null) }}><Plus size={16} />再加一项任务</Button><div className="editor-footer"><span><ShieldCheck size={15} />下一步先预览，不会直接发布</span><Button type="submit" busy={busy}>检查并预览<ArrowRight size={16} /></Button></div></form> : <><div className="panel"><h3>任务完成进度</h3><p className="muted">数据来自同学自报完成，点击查看接收人和未完成人员。</p>{adminTasks.length ? adminTasks.map(t => <button key={t.id} className="progress-task" onClick={() => viewProgress(t)}><span className="quick-icon"><ClipboardList size={18} /></span><span><strong>{t.title}</strong><small>{formatDate(t.dueAt)}</small></span><span className="text-link">查看进度<ChevronRight size={15} /></span></button>) : <Empty title="还没有任务" text="发布通知后，可以在这里跟进班级进度。" />}</div><div className="panel"><h3>通知管理</h3>{notices.map(n => <div className="management-row" key={n.id}><button className="plain-title" onClick={() => onNotice(n)}>{n.title}<small>{n.status === 'withdrawn' ? '已撤回' : `版本 ${n.version}`}</small></button>{n.status === 'published' && <div><Button variant="ghost" onClick={() => setEdit({ ...n })}>修改</Button><Button variant="ghost" onClick={() => setWithdraw(n)}>撤回</Button></div>}</div>)}</div></>}
    {reviewAction && <Modal title="发布前，再检查一遍" onClose={() => setReviewAction(null)}><div className="publish-preview"><span className="eyebrow">通知预览</span><h2>{draft.title}</h2><p className="notice-content">{draft.content}</p>{draft.tasks.map((t, i) => <div className="preview-task" key={i}><strong>{t.title}</strong><p>{t.description}</p><span>{formatDate(t.dueAt)} · {t.audience === 'all' ? '全班同学' : `${t.memberIds.length} 位指定成员`}</span></div>)}<p className="muted">确认后，通知与待办将同步给接收成员。</p><div className="button-row"><Button variant="outline" onClick={() => setReviewAction(null)}>返回修改</Button><Button busy={busy} onClick={publish}>确认发布<Send size={16} /></Button></div></div></Modal>}
    {progress && <Modal title={progress.task.title} onClose={() => setProgress(null)}><div className="progress-overview"><strong>{progress.completed}<span> / {progress.total}</span></strong><p>位同学已自报完成</p><div className="progress-track"><span style={{ width: `${progress.total ? progress.completed / progress.total * 100 : 0}%` }} /></div></div>{progress.members.map(m => <div className="member-row" key={m.id}><span className="avatar">{m.nickname.slice(-1)}</span><strong>{m.nickname}</strong><span className={`task-badge ${m.status === 'completed' ? 'done' : ''}`}>{m.status === 'completed' ? '已完成' : '未完成'}</span></div>)}</Modal>}
    {edit && <Modal title="修改通知" onClose={() => setEdit(null)}><label>标题<input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label><label>原文<textarea rows={7} value={edit.content} onChange={e => setEdit({ ...edit, content: e.target.value })} /></label><p className="muted">修改会保存新版本；已有任务要求和截止时间不会自动改变。</p><Button busy={busy} onClick={saveNotice}>确认保存新版本</Button></Modal>}
    {withdraw && <Modal title="撤回这条通知？" onClose={() => setWithdraw(null)}><p>{withdraw.title}</p><p className="muted">撤回后，关联任务不再作为有效待办显示。历史操作记录保留。</p><div className="button-row"><Button variant="outline" onClick={() => setWithdraw(null)}>取消</Button><Button variant="danger" busy={busy} onClick={withdrawNotice}>确认撤回</Button></div></Modal>}
  </div>
}

function SettingsPage({ session, tasks, completed, onLogout, onSession, onNotify, onError, onAdmin }: { session: Session; tasks: Task[]; completed: number; onLogout: () => void; onSession: (s: Session) => void; onNotify: (s: string) => void; onError: (s: string) => void; onAdmin: () => void }) {
  const [clear, setClear] = useState(false)
  const [rotate, setRotate] = useState(false)
  const [busy, setBusy] = useState(false)
  async function rotateCode() { setBusy(true); try { const v = await post<{ inviteCode: string }>('/invite/rotate', {}); onSession({ ...session, classroom: { ...session.classroom, inviteCode: v.inviteCode } }); setRotate(false); onNotify('邀请码已更新，旧邀请码已失效') } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function clearChat() { setBusy(true); try { await api('/chat', { method: 'DELETE' }); setClear(false); onNotify('你的对话记录已清空') } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  return <div className="standard-page settings-page"><PageHeading eyebrow="YOUR OWN CLASSROOM SPACE" title="班级与设置" text="照顾好班级，也照顾好你的信息。" /><div className="profile-card"><span className="avatar large">{session.user.nickname.slice(-2)}</span><div><h2>{session.user.nickname}</h2><p>{session.classroom.name} · {session.user.role === 'admin' ? '班干部' : '普通同学'}</p></div><span className="role-tag">{session.classroom.isDemo ? '示例身份' : '班级成员'}</span></div><div className="settings-grid"><section className="panel"><h3><Users size={19} />我们的班级</h3><div className="setting-row"><span>班级名称</span><strong>{session.classroom.name}</strong></div><div className="setting-row"><span>我的任务</span><strong>{completed} / {tasks.length} 已完成</strong></div>{session.user.role === 'admin' && <><div className="invite-box"><span>班级邀请码</span><strong>{session.classroom.inviteCode || '—'}</strong><div><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(session.classroom.inviteCode || ''); onNotify('邀请码已复制') } catch { onError('无法访问剪贴板，请手动复制邀请码') } }}><Copy size={15} />复制</Button><Button variant="ghost" onClick={() => setRotate(true)}>更新邀请码</Button></div></div><label><input type="checkbox" checked={!!session.classroom.allowSelfJoin} disabled={busy} onChange={async e=>{ const allowSelfJoin=e.target.checked;setBusy(true);try{await api('/class/settings',{method:'PATCH',body:JSON.stringify({allowSelfJoin})});onSession({...session,classroom:{...session.classroom,allowSelfJoin}});onNotify(allowSelfJoin?'已允许名单外成员自行加入':'已限制为名单成员加入')}catch(e){onError((e as Error).message)}finally{setBusy(false)}}}/>允许名单外成员自行加入</label><p className="muted">默认关闭；已在名单中的成员可用姓名或学号登录。</p><Button variant="outline" className="full-width" onClick={onAdmin}>进入发布与统计<ArrowRight size={15} /></Button></>}</section><section className="panel"><h3><Sparkles size={19} />关于 AI 助手</h3><div className="mode-explanation"><span className="mode-pill"><span />{session.mode === 'demo' ? '示例演示模式' : session.mode === 'live' ? '真实 AI 已配置' : 'AI 待配置'}</span><p>{session.mode === 'demo' ? '当前使用固定示例和有限规则，未调用真实模型。演示班级与真实班级隔离。' : session.mode === 'live' ? '模型通过后端工具查询班级数据。涉及写入的操作，需要你确认后才会执行。' : '管理员需在服务端配置模型 API。待办、通知和手动发布仍可正常使用。'}</p></div><div className="principle-row"><ShieldCheck size={17} /><span>回答引用原文，重要信息可核对</span></div><div className="principle-row"><CheckCheck size={17} /><span>操作先确认，所有结果可追踪</span></div><div className="principle-row"><Users size={17} /><span>同学只能查看和修改本人的状态</span></div></section></div>{session.user.role === 'admin' && <><ScheduleManagement onError={onError} onNotify={onNotify} /><MemberManagement onError={onError} currentId={session.user.id} onSessionRevoked={onLogout} /></>}<section className="panel"><h3><ShieldCheck size={19} />身份与数据</h3><div className="setting-row"><div><strong>清空对话记录</strong><p>只清除你的 AI 对话，不影响班级通知和任务。</p></div><Button variant="outline" onClick={() => setClear(true)}>清空记录</Button></div><div className="setting-row"><div><strong>退出当前身份</strong><p>下次使用姓名或学号及班级邀请码登录。</p></div><Button variant="outline" onClick={onLogout}><LogOut size={15} />退出</Button></div></section>{clear && <Modal title="清空你的对话记录？" onClose={() => setClear(false)}><p className="muted">此操作会删除当前身份的对话记录，不能恢复。</p><div className="button-row"><Button variant="outline" onClick={() => setClear(false)}>保留记录</Button><Button variant="danger" busy={busy} onClick={clearChat}>确认清空</Button></div></Modal>}{rotate && <Modal title="更新班级邀请码？" onClose={() => setRotate(false)}><p className="muted">更新后旧邀请码立即失效，已加入的成员不受影响。</p><div className="button-row"><Button variant="outline" onClick={() => setRotate(false)}>取消</Button><Button busy={busy} onClick={rotateCode}>确认更新</Button></div></Modal>}</div>
}

function ScheduleManagement({ onError, onNotify }: { onError: (s: string) => void; onNotify: (s: string) => void }) {
  const days = ['周一','周二','周三','周四','周五','周六','周日']
  const [timetable, setTimetable] = useState<Array<{day:string;time:string;course:string;room:string}>>([])
  const [duty, setDuty] = useState<Array<{day:string;name:string}>>([])
  const [members, setMembers] = useState<Member[]>([])
  const [csv, setCsv] = useState({ timetable: '', duty: '' })
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<any>(null)
  const reload = async () => { const [schedule, roster] = await Promise.all([api<any>('/class/schedule'), api<{members:Member[]}>('/members')]); setTimetable(schedule.timetable); setDuty(schedule.duty.map((row:any)=>({day:row.day,name:row.name}))); setMembers(roster.members) }
  useEffect(() => { reload().catch(e => onError(e.message)) }, [])
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); try { await api('/class/schedule', { method: 'PUT', body: JSON.stringify({ timetable, duty }) }); await reload(); onNotify('课表和值日安排已保存') } catch(e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function importCsv(e: FormEvent) { e.preventDefault(); setBusy(true); try { setReport(await post('/class/schedule/import', csv)); await reload(); onNotify('导入完成，请核对结果') } catch(e) { onError((e as Error).message) } finally { setBusy(false) } }
  return <section className="panel"><h3><CalendarDays size={19} />课程表和值日安排</h3><p className="muted">按星期设置重复安排。值日成员从本班在册成员中选择。</p><form onSubmit={save}><h4>课程表</h4>{timetable.map((row,i)=><div className="form-grid" key={i}><label>星期<select value={row.day} onChange={e=>setTimetable(timetable.map((r,j)=>j===i?{...r,day:e.target.value}:r))}>{days.map(d=><option key={d}>{d}</option>)}</select></label><label>时间<input required value={row.time} placeholder="08:00-09:40" onChange={e=>setTimetable(timetable.map((r,j)=>j===i?{...r,time:e.target.value}:r))}/></label><label>课程<input required value={row.course} onChange={e=>setTimetable(timetable.map((r,j)=>j===i?{...r,course:e.target.value}:r))}/></label><label>教室<input value={row.room} onChange={e=>setTimetable(timetable.map((r,j)=>j===i?{...r,room:e.target.value}:r))}/></label><Button type="button" variant="ghost" onClick={()=>setTimetable(timetable.filter((_,j)=>j!==i))}><X size={16}/></Button></div>)}<Button type="button" variant="outline" onClick={()=>setTimetable([...timetable,{day:'周一',time:'',course:'',room:''}])}><Plus size={15}/>添加课程</Button><h4>值日安排</h4>{duty.map((row,i)=><div className="form-grid" key={i}><label>星期<select value={row.day} onChange={e=>setDuty(duty.map((r,j)=>j===i?{...r,day:e.target.value}:r))}>{days.map(d=><option key={d}>{d}</option>)}</select></label><label>成员<select value={row.name} onChange={e=>setDuty(duty.map((r,j)=>j===i?{...r,name:e.target.value}:r))}><option value="">选择成员</option>{members.map(m=><option key={m.id} value={m.nickname}>{m.nickname}</option>)}</select></label><Button type="button" variant="ghost" onClick={()=>setDuty(duty.filter((_,j)=>j!==i))}><X size={16}/></Button></div>)}<Button type="button" variant="outline" onClick={()=>setDuty([...duty,{day:'周一',name:''}])}><Plus size={15}/>添加值日成员</Button><div className="editor-footer"><span>{timetable.length} 节课程 · {duty.length} 条值日记录</span><Button busy={busy} type="submit">保存安排</Button></div></form><form onSubmit={importCsv} className="spaced"><h4>CSV 导入</h4><label>课程表 CSV<textarea rows={3} value={csv.timetable} onChange={e=>setCsv({...csv,timetable:e.target.value})} placeholder={'day,time,course,room\n周一,08:00-09:40,高等数学,教3102'}/></label><label>值日 CSV<textarea rows={3} value={csv.duty} onChange={e=>setCsv({...csv,duty:e.target.value})} placeholder={'day,name\n周一,张三'}/></label><Button busy={busy} type="submit" variant="outline">导入有效行</Button></form>{report && <div role="status"><p>课程表：导入 {report.timetable.imported} 行，失败 {report.timetable.failed} 行。值日：导入 {report.duty.imported} 行，失败 {report.duty.failed} 行。</p>{[...report.timetable.errors,...report.duty.errors].map((err:any,i:number)=><p key={i}>第 {err.line} 行：{err.reason}</p>)}</div>}</section>
}

function MemberManagement({ onError, currentId, onSessionRevoked }: { onError: (s: string) => void; currentId: string; onSessionRevoked: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [text, setText] = useState('')
  const [pendingMember, setPendingMember] = useState<{ member: Member; role: 'admin' | 'student' | null } | null>(null)
  async function confirmMemberChange() { if(!pendingMember)return;setBusy(true);try {await api(`/class/members/${pendingMember.member.id}`,{method:pendingMember.role?'PATCH':'DELETE',...(pendingMember.role?{body:JSON.stringify({role:pendingMember.role})}:{})});if(pendingMember.member.id===currentId)onSessionRevoked();else await reload();setPendingMember(null)}catch(e){onError((e as Error).message)}finally{setBusy(false)} }
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; failed: number; errors: { line: number; reason: string }[] } | null>(null)
  const reload = () => api<{ members: Member[] }>('/members').then(v => setMembers(v.members))
  useEffect(() => { reload().catch(e => onError(e.message)) }, [])
  async function importRoster(e: FormEvent) { e.preventDefault(); setBusy(true); setResult(null); try { setResult(await post('/class/members/import', { text })); await reload() } catch(e) { onError((e as Error).message) } finally { setBusy(false) } }
  return <section className="panel"><h3><Users size={19} />成员管理</h3><p className="muted">粘贴名单或上传 UTF-8 CSV。每行：姓名,学号,角色,备注；学号与备注可留空，角色默认成员。支持表头 name,student_no,role,note 和制表符粘贴，每次最多500人。重复成员会跳过。</p><form onSubmit={importRoster}><label>上传 CSV<input type="file" accept=".csv,text/csv" onChange={async e => { const file=e.target.files?.[0]; if(!file)return; if(file.size>60000){onError('文件最多60KB');return} setText(await file.text()); setResult(null) }} /></label><label>名单<textarea rows={6} required maxLength={60000} placeholder={'name,student_no,role,note\n张三,2026001,成员,'} value={text} onChange={e=>setText(e.target.value)} /></label><Button busy={busy} type="submit">导入成员</Button></form>{result && <div role="status"><p>成功 {result.imported} 人，跳过 {result.skipped} 人，失败 {result.failed} 人</p>{result.errors.map((e,i)=><p key={i}>第 {e.line} 行：{e.reason}</p>)}</div>}<div>{members.map(m=><div className="management-row" key={m.id}><span><strong>{m.nickname}</strong><small>{m.studentNo || '未填学号'} · {m.role === 'admin' ? '班干部' : '成员'}{m.note ? ` · ${m.note}` : ''}</small></span><div><Button variant="ghost" disabled={busy} onClick={()=>setPendingMember({member:m,role:m.role==='admin'?'student':'admin'})}>{m.role==='admin'?'设为成员':'设为班干部'}</Button><Button variant="ghost" disabled={busy} onClick={()=>setPendingMember({member:m,role:null})}>移出班级</Button></div></div>)}</div>{pendingMember && <Modal title={pendingMember.role?'修改成员角色？':'移出班级？'} onClose={()=>setPendingMember(null)}><p>{pendingMember.member.nickname}：{pendingMember.role?(pendingMember.role==='admin'?'设为班干部，获得班级管理权限。':'设为成员，取消班级管理权限。'):'移出后不能登录，已有通知及历史记录保留。'}</p><p className="muted">该成员的现有登录将失效。班级须保留至少一位班干部。</p><div className="button-row"><Button variant="outline" onClick={()=>setPendingMember(null)}>取消</Button><Button busy={busy} variant={pendingMember.role?'primary':'danger'} onClick={confirmMemberChange}>确认{pendingMember.role?'修改':'移出'}</Button></div></Modal>}</section>
}
