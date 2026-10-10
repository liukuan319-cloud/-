import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowRight, ArrowUp, Bell, BookOpen, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, ClipboardList, Clock3, Copy, FileText, LayoutDashboard, Leaf, ListTodo, LoaderCircle, LogOut, Menu, MessageCircle, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Users, WandSparkles, X } from 'lucide-react'
import { api, post, formatDate, overdue, beijingInput, beijingISOString } from './api'
import type { Action, ChatCard, Draft, DraftTask, Member, Message, Notice, NoticeCategory, Session, Task } from './api'
import { BRAND } from './config'
import { AcademicsPage, CalendarPage, VotesPage, RemindersPage } from './ExpandedPages'
import { AuthPage } from './AuthPage'
import { AccountSettings } from './AccountSettings'
import { PersonalTasks } from './PersonalTasks'

type Page = 'ai' | 'tasks' | 'notices' | 'admin' | 'settings' | 'academics' | 'calendar' | 'votes' | 'reminders'
const primaryNav = [
  { id: 'ai' as const, name: '首页' },
  { id: 'notices' as const, name: '通知', items: ['全部', '重要公告', '组队通知', '考证考试', '活动报名', '日常事务'] },
  { id: 'academics' as const, name: '学业', items: ['学业概览', '课程表', '考试安排'] },
  { id: 'settings' as const, name: '班级', items: ['班级概览', '日历', '投票', '提醒', '成员名单', '班级设置'] },
  { id: 'tasks' as const, name: '更多', items: ['我的待办', '站内提醒', '班级设置'] },
] as const
const uid = () => crypto.randomUUID()
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const blankTask = (): DraftTask => ({ title: '', description: '', dueAt: null, audience: 'all', memberIds: [] })
const blankDraft = (): Draft => ({ title: '', content: '', sourceDate: today(), priority: 'normal', pinned: false, tasks: [blankTask()] })

function Button({ children, busy, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'ghost' | 'outline' | 'danger' }) {
  return <button {...props} className={`btn ${variant} ${props.className || ''}`} disabled={props.disabled || busy}>{busy && <LoaderCircle size={16} className="spin" />}{children}</button>
}
function ProgressRing({ value }: { value: number }) {
  return <div className="progress-ring" aria-label={`完成进度 ${value}%`}><svg viewBox="0 0 104 104" aria-hidden="true"><circle className="ring-track" cx="52" cy="52" r="43" /><circle className="ring-value" cx="52" cy="52" r="43" strokeDasharray={`${value * 2.702} 270.2`} /></svg><span>{value}%</span></div>
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [section, setSection] = useState('首页')
  const [noticeCategory, setNoticeCategory] = useState<NoticeCategory | 'all'>('all')
  const [reminderCount,setReminderCount]=useState(0)
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

  useEffect(() => { api<Session>('/session').then(value => { if (value.classroom.isDemo) { void api('/session', { method: 'DELETE' }); setSession(null) } else setSession(value) }).catch(() => {}).finally(() => setBooting(false)) }, [])
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
  function signedIn(value: Session) { setSession(value); setPage('ai'); setSection('首页') }
  useEffect(()=>{if(!session)return;api<{reminders:unknown[]}>('/reminders').then(value=>setReminderCount(value.reminders.length)).catch(()=>setReminderCount(0))},[session?.user.id,page])
  function navigate(next: Page, label: string) { setPage(next); setSection(label); setDrawerOpen(false) }
  function navigateItem(parent: string, item: string) {
    if (parent === '通知') { const ids: Record<string, NoticeCategory | 'all'> = { '全部': 'all', '重要公告': 'important', '组队通知': 'team', '考证考试': 'exam', '活动报名': 'activity', '日常事务': 'daily' }; setNoticeCategory(ids[item] || 'all'); navigate('notices', item) }
    else if (item === '我的待办') navigate('tasks', item)
    else if (item === '学业概览') navigate('academics', item)
    else if (item === '课程表' || item === '考试安排') navigate('calendar', item)
    else if (item === '日历') navigate('calendar', item)
    else if (item === '投票') navigate('votes', item)
    else if (item === '提醒' || item === '站内提醒') navigate('reminders', item)
    else if (item === '班级设置' || item === '班级概览' || item === '成员名单') navigate('settings', item)
  }
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
    try { const response=await post<{result:{message?:string;inviteCode?:string}}>(`/actions/${pending.id}/confirm`, {}); setPending(null); setToast(response.result.message||'操作已完成'); await refresh(); if(pending.type==='class_reset')location.reload(); if(['class_name','invite_rotate'].includes(pending.type)){const current=await api<Session>('/session');setSession(current)} }
    catch (e) { setError((e as Error).message) } finally { setConfirming(false) }
  }
  function showNotice(id: string) { const notice = notices.find(n => n.id === id); if (notice) setSelectedNotice(notice); else api<{ notice: Notice }>(`/notices/${id}`).then(v => setSelectedNotice(v.notice)).catch(e => setError(e.message)) }
  const remaining = tasks.filter(t => t.status === 'pending').length
  const completed = tasks.length - remaining
  if (booting) return <div className="boot"><Brand /><LoaderCircle className="spin" /><span>正在准备你的班级空间…</span></div>
  if (!session) return <AuthPage onSignIn={signedIn} />
  const navigation = primaryNav.map(group => 'items' in group ? { ...group, items: group.items.filter(item => (item !== '班级设置' || session.user.accessRole === 'faculty') && (item !== '成员名单' || session.user.accessRole !== 'student')) } : group)
  return <div className="app-shell">
    <header className="site-header"><div className="topbar"><button className="brand-button" onClick={() => navigate('ai', '首页')} aria-label="返回首页"><Brand /></button><nav className="desktop-navigation" aria-label="主导航">{navigation.map(group => <div className={`nav-group ${page === group.id || (group.name === '更多' && page === 'admin') ? 'active' : ''}`} key={group.name}><button onClick={() => navigate(group.id, group.name)}>{group.name}{'items' in group && <ChevronDown size={14} />}</button>{'items' in group && <div className="nav-dropdown">{group.items.map(item => <button key={item} onClick={() => navigateItem(group.name, item)}>{item}</button>)}{group.name === '更多' && session.user.accessRole !== 'student' && <button onClick={() => navigate('admin', '发布与统计')}>发布与统计</button>}</div>}</div>)}</nav><div className="topbar-right"><span className="class-name">{session.classroom.name}</span><button className="header-alert icon-btn" aria-label="查看提醒" onClick={() => navigate('reminders', '提醒')}><Bell size={19} />{reminderCount>0&&<span className="notification-badge">{Math.min(reminderCount,9)}</span>}</button><button className="profile-trigger" onClick={() => navigate('settings', '我的班级')} aria-label="我的班级"><span className="avatar">{session.user.nickname.slice(-2)}</span><span>{session.user.nickname}</span></button><button className="menu-trigger icon-btn" aria-label={drawerOpen ? '关闭导航' : '打开导航'} aria-expanded={drawerOpen} onClick={() => setDrawerOpen(!drawerOpen)}>{drawerOpen ? <X size={23} /> : <Menu size={23} />}</button></div></div></header>
    {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}><nav className="mobile-drawer" aria-label="手机导航" onClick={e => e.stopPropagation()}><div className="drawer-heading"><span>{session.classroom.name}</span><button className="icon-btn" onClick={() => setDrawerOpen(false)} aria-label="关闭导航"><X size={20} /></button></div>{navigation.map(group => <div className="drawer-group" key={group.name}><button className="drawer-primary" onClick={() => navigate(group.id, group.name)}>{group.name}<ChevronRight size={17} /></button>{'items' in group && <div className="drawer-items">{group.items.map(item => <button key={item} onClick={() => navigateItem(group.name, item)}>{item}</button>)}{group.name === '更多' && session.user.accessRole !== 'student' && <button onClick={() => navigate('admin', '发布与统计')}>发布与统计</button>}</div>}</div>)}</nav></div>}
    <div className="main-shell">{page !== 'ai' && <div className="breadcrumb"><button onClick={() => navigate('ai', '首页')}>首页</button><ChevronRight size={15} /><span>{section}</span></div>}
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div>}
      <main className="main-content">
        {page === 'ai' && <><ReminderBanner onOpen={()=>navigate('reminders','提醒')} onCount={setReminderCount}/><ChatView session={session} tasks={tasks} loading={loading} onTask={prepareTask} onNotice={showNotice} onPage={setPage} onAction={setPending} onDraft={value => { setTransferredDraft(value); setPage('admin') }} onRefresh={refresh} /></>}
        {page === 'tasks' && <><TasksPage tasks={tasks} loading={loading} onTask={prepareTask} onNotice={showNotice} /><PersonalTasks onError={setError} /></>}
        {page === 'academics' && <AcademicsPage session={session} onError={setError} />}
        {page === 'calendar' && <CalendarPage session={session} onError={setError} />}
        {page === 'votes' && <VotesPage session={session} onError={setError} />}
        {page === 'reminders' && <RemindersPage session={session} onError={setError} />}
        {page === 'notices' && <NoticesPage notices={notices} loading={loading} category={noticeCategory} memberId={session.user.id} onNotice={setSelectedNotice} />}
        {page === 'admin' && session.user.accessRole !== 'student' && <AdminPage initialDraft={transferredDraft} onConsumeDraft={() => setTransferredDraft(null)} tasks={tasks} notices={notices} onRefresh={refresh} onNotice={setSelectedNotice} onError={setError} />}
    {page === 'settings' && <SettingsPage session={session} tasks={tasks} completed={completed} onLogout={logout} onSession={setSession} onNotify={setToast} onError={setError} onAdmin={() => setPage('admin')} />}
      </main>
      <footer className="page-footer"><ShieldCheck size={13} />回答有来源，操作由你确认<span>与你一起，把班级事务变简单</span></footer>
    </div>
    {toast && <div className="toast" role="status"><CheckCheck size={18} />{toast}</div>}

    {selectedNotice && <Modal title="通知详情" onClose={() => setSelectedNotice(null)}><div className="notice-modal"><span className="eyebrow"><i className="notice-dot" style={{ background: selectedNotice.categoryColor }} />{selectedNotice.categoryName || '班级通知'}{selectedNotice.pinned && ' · 置顶'}</span><h1>{selectedNotice.title}</h1><p className="muted">{selectedNotice.authorName} · {formatDate(selectedNotice.createdAt)}{selectedNotice.version > 1 && ' · 已更新'}</p><div className="notice-content">{selectedNotice.content}</div><div className="source-note"><ShieldCheck size={16} />AI 回答以这条通知为依据。时间均为北京时间。</div></div></Modal>}
    {pending && <Modal title="确认你的操作" onClose={() => setPending(null)}><div className="confirm-body"><span className="confirm-icon"><CheckCheck size={28} /></span><h3>{actionPreview(pending).title}</h3><p>{actionPreview(pending).detail}</p><p className="muted">{pending.type==='class_reset'?'此操作会清空本班数据且不可恢复。':'确认后才会保存，操作将记录在班级日志中。'}</p><div className="button-row"><Button variant="outline" onClick={() => setPending(null)}>再检查一下</Button><Button busy={confirming} variant={pending.type==='class_reset'?'danger':'primary'} onClick={confirmAction}>确认执行 <Check size={16} /></Button></div></div></Modal>}
  </div>
}
function actionPreview(action:Action){
  const p=action.payload;
  switch(action.type){
    case 'task_status':case 'personal_task_status':return {title:p.status==='pending'?'改回待完成？':'确认已完成？',detail:String(p.title||p.taskTitle||p.taskId||'本人待办')};
    case 'personal_tasks_create':return {title:'创建个人待办？',detail:Array.isArray(p.tasks)?p.tasks.map((task:any)=>task.title).join('、'):''};
    case 'create_vote':return {title:'发起这项投票？',detail:`${String(p.title)} · ${Array.isArray(p.options)?p.options.join('、'):''}`};
    case 'member_role':return {title:'修改成员角色？',detail:`${String(p.memberName)} → ${p.role==='cadre'?'班干部':'学生'}`};
    case 'password_reset':return {title:'重置成员密码？',detail:`${String(p.memberName)} 须重新使用学号和班级邀请码激活。`};
    case 'class_name':return {title:'修改班级名称？',detail:String(p.name)};
    case 'invite_rotate':return {title:'重置邀请码？',detail:'旧邀请码将立即失效。'};
    case 'class_reset':return {title:'清空并重建本班？',detail:'现有通知、投票、成绩、值日及成员数据将被清空。'};
    case 'schedule_add':return {title:'录入这节课？',detail:`${String(p.day)} ${String(p.time)} · ${String(p.course)} · ${String(p.room||'教室待确认')}`};
    case 'duty_add':return {title:'录入值日安排？',detail:`${String(p.day)} · ${String(p.memberName)}`};
    case 'exam_add':return {title:'录入考试？',detail:`${String(p.name)} · ${String(p.examAt)}`};
    case 'calendar_event_add':return {title:'录入校历节点？',detail:`${String(p.eventDate)} · ${String(p.title)}`};
    case 'student_import':return {title:'将学生加入名单？',detail:`${String(p.name)} · 学号 ${String(p.studentNo)}`};
    case 'grade_set':return {title:'录入这项成绩？',detail:`${String(p.memberName)} · ${String(p.courseName)} · ${String(p.score)} 分`};
    default:return {title:'确认操作？',detail:String(p.title||'请核对后继续。')};
  }
}

function Brand() { return <div className="brand"><div className="brand-mark"><Sparkles size={23} strokeWidth={1.8} /></div><strong>{BRAND.name}</strong></div> }
function ReminderBanner({onOpen,onCount}:{onOpen:()=>void;onCount:(value:number)=>void}){
 const [items,setItems]=useState<Array<{key:string;message:string;dueDate:string}>>([])
 const [expanded,setExpanded]=useState(false)
 useEffect(()=>{api<{reminders:Array<{key:string;message:string;dueDate:string}>}>('/reminders').then(result=>{setItems(result.reminders);onCount(result.reminders.length)}).catch(()=>setItems([]))},[])
 if(!items.length)return null
 return <section className="reminder-banner" aria-label="近期提醒"><div className="reminder-banner-head"><Bell size={18}/><strong>近期提醒</strong><button onClick={onOpen}>查看全部<ArrowRight size={14}/></button></div>{items.slice(0,expanded?items.length:3).map(item=><div className="reminder-banner-row" key={item.key}><span>{item.message}</span><time>{item.dueDate}</time></div>)}{items.length>3&&<button className="reminder-more" onClick={()=>setExpanded(!expanded)}>{expanded?'收起':`还有 ${items.length-3} 条`}</button>}</section>
}
function Welcome({ onSignIn }: { onSignIn: (s: Session) => void }) {
  const [mode, setMode] = useState<'join' | 'create'>('join')
  const [identifierKind, setIdentifierKind] = useState<'nickname' | 'studentNo'>('nickname')
  const [nickname, setNickname] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  async function submit(e: FormEvent) { e.preventDefault(); setBusy('form'); setError(''); try { onSignIn(await post<Session>(mode === 'join' ? '/join' : '/classes', mode === 'join' ? { inviteCode: value, [identifierKind]: nickname } : { name: value, nickname })) } catch (e) { setError((e as Error).message) } finally { setBusy('') } }
  return <div className="welcome"><header><Brand /><span className="welcome-label"><Leaf size={15} />为更从容的班级生活而设计</span></header><main className="welcome-main"><section className="welcome-copy"><span className="eyebrow"><span className="green-dot" />你的班级，现在更有条理</span><h1>班级大小事，<br />问一句<span className="hand-underline">就清楚。</span></h1><p>通知不用翻，待办不再漏。<br />让 AI 帮你理清每一件事，把时间留给更重要的事。</p><div className="welcome-feature"><span><ShieldCheck size={17} />回答有来源</span><span><CheckCheck size={17} />操作可确认</span><span><ClipboardList size={17} />进度可追踪</span></div><div className="preview-bubble"><div className="mini-ai"><Sparkles size={20} /></div><div><strong>“这周还有什么要交？”</strong><p>帮你查清截止时间、提交要求和原始通知。</p></div><ArrowRight size={19} /></div><div className="welcome-stamp"><div className="stamp-avatars"><i>林</i><i>陈</i><i>李</i></div><span>让班干部和同学，都少一点琐碎。</span></div></section><section className="entry-card"><div className="entry-leaf"><Leaf size={24} /></div><h2>{mode === 'join' ? '欢迎来到班级空间' : '创建我们的班级'}</h2><p className="muted">从一条通知开始，让每件小事都有着落。</p><div className="entry-tabs">{([{ id: 'join', text: '加入班级' }, { id: 'create', text: '创建班级' }] as const).map(t => <button key={t.id} className={mode === t.id ? 'active' : ''} onClick={() => { setMode(t.id); setValue(''); setError('') }}>{t.text}</button>)}</div><form onSubmit={submit}>{mode === 'join' && <label>登录方式<select value={identifierKind} onChange={e=>{setIdentifierKind(e.target.value as 'nickname'|'studentNo');setNickname('')}}><option value="nickname">姓名</option><option value="studentNo">学号</option></select></label>}<label>{mode === 'join' ? (identifierKind === 'studentNo' ? '你的学号' : '你的姓名') : '你的姓名'}<input required maxLength={mode==='join'&&identifierKind==='studentNo'?64:24} autoComplete="off" placeholder={identifierKind==='studentNo'&&mode==='join'?'名单中的学号':'名单中的姓名'} value={nickname} onChange={e=>setNickname(e.target.value)} /></label><label>{mode==='join'?'班级邀请码':'班级名称'}<input required maxLength={80} autoComplete="off" placeholder={mode==='join'?'向班干部获取邀请码':'例如：2026 级计算机 1 班'} value={value} onChange={e=>setValue(e.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" busy={busy==='form'} disabled={!!busy} className="full-width">{mode==='join'?'进入班级':'创建班级空间'}<ArrowRight size={17}/></Button></form></section></main><footer><span>© {new Date().getFullYear()} {BRAND.name}</span><span>让通知成为行动，让班级更有温度。</span></footer></div>
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
  const todayTasks = pendingTasks.filter(t => t.dueAt && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t.dueAt)) <= today())
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
  const completion = tasks.length ? Math.round((tasks.length - pendingTasks.length) / tasks.length * 100) : 0
  const welcomeText = loading ? '正在查看你的班级待办…' : todayTasks.length
    ? `你好，${session.user.nickname}！今天有 ${todayTasks.length} 件事等你处理：${todayTasks.slice(0, 2).map(task => task.title).join('、')}${todayTasks.length > 2 ? '等' : ''}。来源：我的待办。`
    : `你好，${session.user.nickname}！今天没有待办，好好享受吧。`
  return <div className="ai-layout"><section className="chat-column"><div className="greeting-row"><div><span className="eyebrow">今天的班级空间</span><h1>你好，{session.user.nickname}<span className="wave">☀</span></h1><p>今天也一起，把班级的事安排好。</p></div><div className="greeting-decoration"><Leaf size={40} strokeWidth={1.1} /><span /></div></div><button className="mobile-task-summary" onClick={() => onPage('tasks')}><ListTodo size={17} />还有 <strong>{pendingTasks.length}</strong> 项待办，今天也有条不紊<ChevronRight size={16} /></button><div className="conversation-panel"><div className="conversation-heading"><div className="ai-avatar"><Sparkles size={21} /></div><div><strong>你的班级 AI 助手</strong><span><span className="green-dot" />实时查询班级数据</span></div><span className="beta-pill">AI</span></div><div className="conversation-body">
      {messages.length === 0 ? <div className="chat-welcome"><div className="orb"><Sparkles size={34} strokeWidth={1.4} /><span className="orb-star">✧</span></div><h2>班务有点多？<br /><span>从问我一句开始。</span></h2><p role="status">{welcomeText}</p><p>我是班枢，可以帮你查课表、值日、通知、考试、投票、绩点、学分和提醒。</p><div className="prompt-grid">{[{ icon: ListTodo, title: '看看我的待办', text: '我今天需要做什么？', color: 'mint' }, { icon: Search, title: '找一条班级通知', text: '帮我找运动会报名要求', color: 'blue' }, { icon: CalendarDays, title: '安排这周的事', text: '这周有什么要交？', color: 'peach' }, { icon: CheckCheck, title: session.user.role === 'admin' ? '了解班级进度' : '更新任务状态', text: session.user.role === 'admin' ? '运动会报名还有谁没完成？' : '我已经完成运动会报名', color: 'purple' }].map(p => <button key={p.title} className="prompt-card" onClick={() => send(p.text)}><span className={`prompt-icon ${p.color}`}><p.icon size={18} /></span><strong>{p.title}</strong><small>{p.text}</small><ArrowUp size={15} /></button>)}</div></div> : <div className="message-list">{messages.map(m => <div key={m.id} className={`message ${m.role}`}><span className={m.role === 'assistant' ? 'mini-ai' : 'avatar'}>{m.role === 'assistant' ? <Sparkles size={17} /> : session.user.nickname.slice(-1)}</span><div className="message-main"><span className="message-name">{m.role === 'assistant' ? BRAND.name : session.user.nickname}</span><div className="message-content">{m.content}</div>{m.cards?.map((card, i) => <ResultCard key={i} card={card} tasks={tasks} onTask={onTask} onNotice={onNotice} onAction={onAction} onPage={onPage} onDraft={onDraft} />)}</div></div>)}<div ref={end} /></div>}
      {busy && <div className="thinking"><LoaderCircle size={15} className="spin" />{status}</div>}{error && <p className="chat-error" role="alert">{error} 输入已保留，可重新发送。</p>}</div><form className="composer" onSubmit={e => { e.preventDefault(); void send(input) }}><textarea aria-label="向班级 AI 提问" placeholder="问问班级的事，或者粘贴一条通知…" value={input} maxLength={12000} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input) } }} rows={2} /><div className="composer-bottom">{session.user.role === 'admin' && <label className="source-date">原通知日期<input type="date" aria-label="原通知日期" value={sourceDate} onChange={e => setSourceDate(e.target.value)} /></label>}<span><ShieldCheck size={14} />重要操作会先请你确认</span><span className="enter-hint">Enter 发送 · Shift + Enter 换行</span><button className="send-button" type="submit" disabled={busy || !input.trim()} aria-label="发送消息">{busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={20} />}</button></div></form><div className="chat-disclaimer">AI 可能遗漏细节，请以原始通知和确认页面为准。</div></div></section>
    <aside className="right-panel">
      <div className="today-card">
        <div className="section-top"><h3><span className="green-dot" />我的待办</h3><button className="text-link" onClick={() => onPage('tasks')}>查看全部<ArrowRight size={14} /></button></div>
        <div className="task-overview"><div className="task-count"><strong>{pendingTasks.length.toString().padStart(2, '0')}</strong><div>件事等你完成<br /><small>{tasks.filter(t => t.status === 'completed').length} 件已经完成</small></div></div><ProgressRing value={completion} /></div>
        <div className="mini-task-list">{loading ? <Skeleton /> : pendingTasks.slice(0, 3).map(t => <div className="mini-task" key={t.id}><button className="check-circle" aria-label={`完成${t.title}`} onClick={() => onTask(t)} /><div><button className="plain-title" onClick={() => onNotice(t.noticeId)}>{t.title}</button><span className={overdue(t) ? 'due overdue' : 'due'}><Clock3 size={12} />{overdue(t) ? '已逾期 · ' : ''}{formatDate(t.dueAt)}</span></div></div>)}{!loading && pendingTasks.length === 0 && <p className="muted all-done">当前没有待办</p>}</div>
        <div className="progress-label"><span>我的完成进度</span><strong>{completion}%</strong></div>
      </div>
      <div className="quick-card"><h3>班级快捷入口</h3><button onClick={() => onPage('notices')}><span className="quick-icon"><FileText size={18} /></span><span><strong>全部通知</strong><small>查看班级发布的消息</small></span><ChevronRight size={16} /></button><button onClick={() => onPage(session.user.role === 'admin' ? 'admin' : 'settings')}><span className="quick-icon peach"><Users size={18} /></span><span><strong>{session.user.role === 'admin' ? '发布与统计' : '我的班级'}</strong><small>{session.user.role === 'admin' ? '管理通知与任务进度' : session.classroom.name}</small></span><ChevronRight size={16} /></button></div>
      <div className="right-bottom"><ShieldCheck size={15} /><span>班级数据，仅对授权成员可见</span></div>
    </aside></div>
}

function ResultCard({ card, tasks, onTask, onNotice, onAction, onPage, onDraft }: { card: ChatCard; tasks: Task[]; onTask: (t: Task) => void; onNotice: (id: string) => void; onAction: (a: Action) => void; onPage: (p: Page) => void; onDraft: (draft: Draft) => void }) {
  const list = Array.isArray(card.tasks) ? card.tasks as Task[] : card.task ? [card.task as Task] : []
  const action = (card.action || (card.type === 'action' ? card : null)) as Action | null
  if (card.type === 'draft' || action?.type === 'publish_notice') return <div className="result-card"><FileText size={18} /><strong>通知草稿已准备好</strong><p>请到发布与统计中检查原文、日期和接收人后发布。</p><Button variant="outline" onClick={() => { if (action?.payload) onDraft(action.payload as unknown as Draft); else onPage('admin') }}>检查通知草稿<ArrowRight size={15} /></Button></div>
  if (action?.id) return <div className="result-card"><CheckCheck size={19} /><strong>操作待你确认</strong><p>{actionPreview(action).title} {actionPreview(action).detail}</p><Button onClick={() => onAction(action)}>查看并确认</Button></div>
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
const noticeCategories: { id: NoticeCategory | 'all'; name: string; color?: string }[] = [
  { id: 'all', name: '全部' }, { id: 'important', name: '重要公告', color: '#c75b4b' },
  { id: 'team', name: '组队通知', color: '#5a8f72' }, { id: 'exam', name: '考证考试', color: '#6d7fb2' },
  { id: 'activity', name: '活动报名', color: '#c68a43' }, { id: 'daily', name: '日常事务', color: '#8b9d8d' }
]
const noticeCategoryHints: Record<NoticeCategory, string> = {
  important: '全班必读，可置顶', team: '竞赛与项目招募', exam: '报名截止与考试提醒', activity: '聚餐、出游等活动报名', daily: '其他班级事务',
}
function NoticesPage({ notices, loading, category, memberId, onNotice }: { notices: Notice[]; loading: boolean; category: NoticeCategory | 'all'; memberId: string; onNotice: (n: Notice) => void }) {
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<NoticeCategory | 'all'>(category)
  const storageKey = `banshu-read-notices:${memberId}`
  const [readVersions, setReadVersions] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, number> } catch { return {} }
  })
  useEffect(() => setActive(category), [category])
  useEffect(() => { try { setReadVersions(JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, number>) } catch { setReadVersions({}) } }, [storageKey])
  const openNotice = (notice: Notice) => {
    const next = { ...readVersions, [notice.id]: notice.version }
    setReadVersions(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Reading still works without local storage. */ }
    onNotice(notice)
  }
  const unreadPinned = notices.some(n => n.status === 'published' && n.categoryId === 'important' && n.pinned && (readVersions[n.id] || 0) < n.version)
  const filtered = notices.filter(n => n.status === 'published' && (active === 'all' || n.categoryId === active) && `${n.title} ${n.content}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <div className="standard-page"><PageHeading eyebrow="EVERY MESSAGE MATTERS" title="班级通知" text="不再翻聊天记录，重要消息都在这里。" />
    <div className="search-field"><Search size={19} /><input aria-label="搜索通知" value={search} placeholder="搜索通知标题或内容…" onChange={e => setSearch(e.target.value)} /><span>{filtered.length} 条通知</span></div>
    <div className="notice-filters" aria-label="通知分类">{noticeCategories.map(c => <button key={c.id} className={active === c.id ? 'active' : ''} aria-pressed={active === c.id} onClick={() => setActive(c.id)}>{c.color && <i className="notice-dot" style={{ background: c.color }} />}{c.name}{c.id === 'important' && unreadPinned && <span className="notice-unread-dot" aria-label="有未读置顶公告" />}</button>)}</div>
    {loading ? <Skeleton /> : filtered.length ? <div className="notice-grid">{filtered.map(n => <button className="notice-card" key={n.id} onClick={() => openNotice(n)}><div className="notice-card-top"><span className="notice-icon"><FileText size={21} /></span><span className="notice-type"><i className="notice-dot" style={{ background: n.categoryColor }} />{n.categoryName || '日常事务'}{n.version > 1 && ' · 已更新'}</span>{n.pinned && <span className="notice-pin">置顶</span>}</div><h3>{n.title}</h3><p>{n.content}</p><div className="notice-card-footer"><span>{n.authorName}</span><span>{formatDate(n.createdAt, true)}</span></div></button>)}</div> : <Empty title={search || active !== 'all' ? '暂无符合条件的通知' : '我们的第一条通知，等你发布'} text={search || active !== 'all' ? '可以换个分类或关键词。' : '班干部发布后，全班都能在这里查看。'} />}
  </div>
}

function NoticeFields({ value, onChange }: { value: Draft; onChange: (next: Draft) => void }) {
  return <><p className="notice-first-tip">发布后全员可见；重要公告请选择分类并开启置顶。</p><div className="form-grid"><label>分类<select required value={value.categoryId || ''} onChange={e => { const categoryId = e.target.value as NoticeCategory; onChange({ ...value, categoryId, pinned: categoryId === 'important' }) }}><option value="">选择分类</option>{noticeCategories.filter(c => c.id !== 'all').map(c => <option value={c.id} key={c.id}>{c.name} · {noticeCategoryHints[c.id as NoticeCategory]}</option>)}</select></label><label>优先级<select value={value.priority || 'normal'} onChange={e => onChange({ ...value, priority: e.target.value as 'normal' | 'high' })}><option value="normal">普通</option><option value="high">较高</option></select></label></div>{value.categoryId && <p className="notice-category-hint">{noticeCategoryHints[value.categoryId]}</p>}<label>来源时间（北京时间，可选）<DueDateInput value={value.sourceTime || null} onChange={sourceTime => onChange({ ...value, sourceTime })} /></label>{value.categoryId === 'important' && <label className="ios-switch notice-pin-control"><input type="checkbox" role="switch" checked={!!value.pinned} onChange={e => onChange({ ...value, pinned: e.target.checked })} /><span className="ios-switch-track" aria-hidden="true"><span /></span><span>置顶这条重要公告</span></label>}</>
}

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
  async function prepare(e: FormEvent) { e.preventDefault(); if (!draft.categoryId) { onError('请选择通知分类。'); return } setBusy(true); setPublished(false); try { const v = await post<{ action: Action }>('/drafts', draft); setReviewAction(v.action) } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function publish() { if (!reviewAction) return; setBusy(true); try { await post(`/actions/${reviewAction.id}/confirm`, { draft }); setReviewAction(null); setPublished(true); setDraft(blankDraft()); await onRefresh() } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function viewProgress(task: Task) { try { const v = await api<{ total: number; completed: number; members: Member[] }>(`/tasks/${task.id}/progress`); setProgress({ task, ...v }) } catch (e) { onError((e as Error).message) } }
  async function saveNotice() { if (!edit) return; setBusy(true); try { await api(`/notices/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ title: edit.title, content: edit.content, sourceDate: edit.sourceDate, sourceTime: edit.sourceTime, categoryId: edit.categoryId, priority: edit.priority, pinned: edit.pinned, version: edit.version }) }); setEdit(null); await onRefresh() } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function withdrawNotice() { if (!withdraw) return; setBusy(true); try { await api(`/notices/${withdraw.id}`, { method: 'DELETE', body: JSON.stringify({ version: withdraw.version }) }); setWithdraw(null); await onRefresh() } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  return <div className="standard-page"><PageHeading eyebrow="LESS ADMIN, MORE CONNECTION" title="发布与统计" text="把一条通知，变成全班清晰的下一步。" /><div className="tab-row"><button className={tab === 'publish' ? 'active' : ''} onClick={() => setTab('publish')}>整理并发布</button><button className={tab === 'progress' ? 'active' : ''} onClick={() => setTab('progress')}>完成统计与通知管理</button></div>{published && <div className="success-banner"><CheckCheck size={18} />通知已发布，接收同学可以查看关联待办。</div>}{tab === 'publish' ? <form className="editor-panel" onSubmit={prepare}><div className="editor-heading"><span className="step-bubble">1</span><div><h3>保留原文，理清重点</h3><p>可先在 AI 助手中整理通知，也可以在这里手动填写。</p></div></div><NoticeFields value={draft} onChange={next => { setDraft(next); setReviewAction(null) }} /><div className="form-grid"><label>通知标题<input required maxLength={120} value={draft.title} onChange={e => { setDraft({ ...draft, title: e.target.value }); setReviewAction(null) }} placeholder="例如：秋季运动会报名通知" /></label><label>原通知日期<input type="date" required value={draft.sourceDate.slice(0, 10)} onChange={e => { setDraft({ ...draft, sourceDate: e.target.value }); setReviewAction(null) }} /></label></div><label>原始通知<textarea required rows={5} maxLength={12000} value={draft.content} onChange={e => { setDraft({ ...draft, content: e.target.value }); setReviewAction(null) }} placeholder="粘贴脱敏后的原通知。请保留提交要求和时间信息。" /></label><div className="editor-heading spaced"><span className="step-bubble">2</span><div><h3>检查任务与接收人</h3><p>不明确的日期请先核对。没有截止日期可以留空。</p></div></div>{draft.tasks.map((t, index) => <div className="draft-task" key={index}><div className="draft-task-top"><strong>任务 {index + 1}</strong>{draft.tasks.length > 1 && <button type="button" className="text-link" onClick={() => { setDraft({ ...draft, tasks: draft.tasks.filter((_, i) => i !== index) }); setReviewAction(null) }}>移除<X size={13} /></button>}</div><label>要完成的事<input required value={t.title} maxLength={120} onChange={e => updateTask(index, { title: e.target.value })} placeholder="例如：提交运动会报名表" /></label><label>任务要求<textarea rows={2} maxLength={4000} value={t.description} onChange={e => updateTask(index, { description: e.target.value })} placeholder="在哪里提交？需要准备什么？" /></label><div className="form-grid"><label>截止时间（北京时间）<DueDateInput value={t.dueAt} onChange={dueAt => updateTask(index, { dueAt })} /></label><label>接收范围<select value={t.audience} onChange={e => updateTask(index, { audience: e.target.value as 'all' | 'selected', memberIds: [] })}><option value="all">全班同学</option><option value="selected">指定成员</option></select></label></div>{t.audience === 'selected' && <div className="member-picker">{members.map(m => <label key={m.id}><input type="checkbox" checked={t.memberIds.includes(m.id)} onChange={e => updateTask(index, { memberIds: e.target.checked ? [...t.memberIds, m.id] : t.memberIds.filter(id => id !== m.id) })} />{m.nickname}</label>)}</div>}</div>)}<Button type="button" variant="outline" disabled={draft.tasks.length >= 12} onClick={() => { setDraft({ ...draft, tasks: [...draft.tasks, blankTask()] }); setReviewAction(null) }}><Plus size={16} />再加一项任务</Button><div className="editor-footer"><span><ShieldCheck size={15} />下一步先预览，不会直接发布</span><Button type="submit" busy={busy}>检查并预览<ArrowRight size={16} /></Button></div></form> : <><div className="panel"><h3>任务完成进度</h3><p className="muted">数据来自同学自报完成，点击查看接收人和未完成人员。</p>{adminTasks.length ? adminTasks.map(t => <button key={t.id} className="progress-task" onClick={() => viewProgress(t)}><span className="quick-icon"><ClipboardList size={18} /></span><span><strong>{t.title}</strong><small>{formatDate(t.dueAt)}</small></span><span className="text-link">查看进度<ChevronRight size={15} /></span></button>) : <Empty title="还没有任务" text="发布通知后，可以在这里跟进班级进度。" />}</div><div className="panel"><h3>通知管理</h3>{notices.map(n => <div className="management-row" key={n.id}><button className="plain-title" onClick={() => onNotice(n)}>{n.title}<small>{n.status === 'withdrawn' ? '已撤回' : `版本 ${n.version}`}</small></button>{n.status === 'published' && <div><Button variant="ghost" onClick={() => setEdit({ ...n })}>修改</Button><Button variant="ghost" onClick={() => setWithdraw(n)}>撤回</Button></div>}</div>)}</div></>}
    {reviewAction && <Modal title="发布前，再检查一遍" onClose={() => setReviewAction(null)}><div className="publish-preview"><span className="eyebrow">{noticeCategories.find(c => c.id === draft.categoryId)?.name} {draft.pinned && '· 置顶'} · {draft.priority === 'high' ? '较高优先级' : '普通优先级'}</span><h2>{draft.title}</h2><p className="muted">来源：{draft.sourceDate}{draft.sourceTime && ` · ${formatDate(draft.sourceTime)}`}</p><p className="notice-content">{draft.content}</p>{draft.tasks.map((t, i) => <div className="preview-task" key={i}><strong>{t.title}</strong><p>{t.description}</p><span>{formatDate(t.dueAt)} · {t.audience === 'all' ? '全班同学' : `${t.memberIds.length} 位指定成员`}</span></div>)}<p className="muted">确认后，通知与待办将同步给接收成员。</p><div className="button-row"><Button variant="outline" onClick={() => setReviewAction(null)}>返回修改</Button><Button busy={busy} onClick={publish}>确认发布<Send size={16} /></Button></div></div></Modal>}
    {progress && <Modal title={progress.task.title} onClose={() => setProgress(null)}><div className="progress-overview"><strong>{progress.completed}<span> / {progress.total}</span></strong><p>位同学已自报完成</p><div className="progress-track"><span style={{ width: `${progress.total ? progress.completed / progress.total * 100 : 0}%` }} /></div></div>{progress.members.map(m => <div className="member-row" key={m.id}><span className="avatar">{m.nickname.slice(-1)}</span><strong>{m.nickname}</strong><span className={`task-badge ${m.status === 'completed' ? 'done' : ''}`}>{m.status === 'completed' ? '已完成' : '未完成'}</span></div>)}</Modal>}
    {edit && <Modal title="修改通知" onClose={() => setEdit(null)}><label>分类<select value={edit.categoryId} onChange={e => { const categoryId = e.target.value as NoticeCategory; setEdit({ ...edit, categoryId, pinned: categoryId === 'important' }) }}>{noticeCategories.filter(c => c.id !== 'all').map(c => <option key={c.id} value={c.id}>{c.name} · {noticeCategoryHints[c.id as NoticeCategory]}</option>)}</select></label><p className="notice-category-hint">{noticeCategoryHints[edit.categoryId]}</p><label>标题<input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label><label>原文<textarea rows={7} value={edit.content} onChange={e => setEdit({ ...edit, content: e.target.value })} /></label><div className="form-grid"><label>来源日期<input type="date" value={edit.sourceDate} onChange={e => setEdit({ ...edit, sourceDate: e.target.value })} /></label><label>优先级<select value={edit.priority} onChange={e => setEdit({ ...edit, priority: e.target.value as 'normal' | 'high' })}><option value="normal">普通</option><option value="high">较高</option></select></label></div><label>来源时间（北京时间）<DueDateInput value={edit.sourceTime} onChange={sourceTime => setEdit({ ...edit, sourceTime })} /></label>{edit.categoryId === 'important' && <label className="ios-switch notice-pin-control"><input type="checkbox" role="switch" checked={edit.pinned} onChange={e => setEdit({ ...edit, pinned: e.target.checked })} /><span className="ios-switch-track" aria-hidden="true"><span /></span><span>置顶这条重要公告</span></label>}<p className="muted">修改会保存新版本；已有任务要求和截止时间不会自动改变。</p><Button busy={busy} onClick={saveNotice}>确认保存新版本</Button></Modal>}
    {withdraw && <Modal title="撤回这条通知？" onClose={() => setWithdraw(null)}><p>{withdraw.title}</p><p className="muted">撤回后，关联任务不再作为有效待办显示。历史操作记录保留。</p><div className="button-row"><Button variant="outline" onClick={() => setWithdraw(null)}>取消</Button><Button variant="danger" busy={busy} onClick={withdrawNotice}>确认撤回</Button></div></Modal>}
  </div>
}

function SettingsPage({ session, tasks, completed, onLogout, onSession, onNotify, onError, onAdmin }: { session: Session; tasks: Task[]; completed: number; onLogout: () => void; onSession: (s: Session) => void; onNotify: (s: string) => void; onError: (s: string) => void; onAdmin: () => void }) {
  const [clear, setClear] = useState(false)
  const [rotate, setRotate] = useState(false)
  const [busy, setBusy] = useState(false)
  async function rotateCode() { setBusy(true); try { const v = await post<{ inviteCode: string }>('/invite/rotate', {}); onSession({ ...session, classroom: { ...session.classroom, inviteCode: v.inviteCode } }); setRotate(false); onNotify('邀请码已更新，旧邀请码已失效') } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function clearChat() { setBusy(true); try { await api('/chat', { method: 'DELETE' }); setClear(false); onNotify('你的对话记录已清空') } catch (e) { onError((e as Error).message) } finally { setBusy(false) } }
  return <div className="standard-page settings-page"><PageHeading eyebrow="YOUR OWN CLASSROOM SPACE" title="班级与设置" text="照顾好班级，也照顾好你的信息。" /><div className="profile-card"><span className="avatar large">{session.user.nickname.slice(-2)}</span><div><h2>{session.user.nickname}</h2><p>{session.classroom.name} · {session.user.accessRole === 'faculty' ? '辅导员' : session.user.accessRole === 'cadre' ? '班干部' : '学生'}</p></div><span className="role-tag">班级成员</span></div><div className="settings-grid"><section className="panel"><h3><Users size={19} />我们的班级</h3><div className="setting-row"><span>班级名称</span><strong>{session.classroom.name}</strong></div><div className="setting-row"><span>我的任务</span><strong>{completed} / {tasks.length} 已完成</strong></div>{session.user.accessRole === 'faculty' && <><div className="invite-box"><span>班级邀请码</span><strong>{session.classroom.inviteCode || '—'}</strong><div><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(session.classroom.inviteCode || ''); onNotify('邀请码已复制') } catch { onError('无法访问剪贴板，请手动复制邀请码') } }}><Copy size={15} />复制</Button><Button variant="ghost" onClick={() => setRotate(true)}>更新邀请码</Button></div></div><Button variant="outline" className="full-width" onClick={onAdmin}>进入发布与统计<ArrowRight size={15} /></Button></>}</section><section className="panel"><h3><Sparkles size={19} />关于 AI 助手</h3><div className="mode-explanation"><span className="mode-pill"><span />班级 AI</span><p>模型通过后端工具查询班级数据。涉及写入的操作，需要你确认后才会执行。</p></div><div className="principle-row"><ShieldCheck size={17} /><span>回答引用原文，重要信息可核对</span></div><div className="principle-row"><CheckCheck size={17} /><span>操作先确认，所有结果可追踪</span></div><div className="principle-row"><Users size={17} /><span>同学只能查看和修改本人的状态</span></div></section></div>{session.user.accessRole !== 'student' && <><ScheduleManagement onError={onError} onNotify={onNotify} /><MemberManagement onError={onError} currentId={session.user.id} accessRole={session.user.accessRole === 'faculty' ? 'faculty' : 'cadre'} onSessionRevoked={onLogout} /></>}<section className="panel"><h3><ShieldCheck size={19} />身份与数据</h3><div className="setting-row"><div><strong>清空对话记录</strong><p>只清除你的 AI 对话，不影响班级通知和任务。</p></div><Button variant="outline" onClick={() => setClear(true)}>清空记录</Button></div><div className="setting-row"><div><strong>退出当前身份</strong><p>下次使用学号或辅导员账号及密码登录。</p></div><Button variant="outline" onClick={onLogout}><LogOut size={15} />退出</Button></div></section><AccountSettings session={session} onSession={onSession} onNotify={onNotify} onError={onError} onLogout={onLogout} />{clear && <Modal title="清空你的对话记录？" onClose={() => setClear(false)}><p className="muted">此操作会删除当前身份的对话记录，不能恢复。</p><div className="button-row"><Button variant="outline" onClick={() => setClear(false)}>保留记录</Button><Button variant="danger" busy={busy} onClick={clearChat}>确认清空</Button></div></Modal>}{rotate && <Modal title="更新班级邀请码？" onClose={() => setRotate(false)}><p className="muted">更新后旧邀请码立即失效，已加入的成员不受影响。</p><div className="button-row"><Button variant="outline" onClick={() => setRotate(false)}>取消</Button><Button busy={busy} onClick={rotateCode}>确认更新</Button></div></Modal>}</div>
}

function ScheduleManagement({ onError, onNotify }: { onError: (s: string) => void; onNotify: (s: string) => void }) {
  const days = ['周一','周二','周三','周四','周五','周六','周日']
  const [timetable, setTimetable] = useState<Array<{day:string;time:string;course:string;room:string}>>([])
  const [duty, setDuty] = useState<Array<{day:string;name:string}>>([])
  const [members, setMembers] = useState<Member[]>([])
  const [csv, setCsv] = useState({ timetable: '', duty: '' })
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<any>(null)
  const reload = async () => { const [schedule, roster] = await Promise.all([api<any>('/class/schedule'), api<{members:Member[]}>('/members')]); setTimetable(schedule.timetable.filter((row:any)=>!row.weekStart).map((row:any)=>({day:row.day,time:row.time,course:row.course,room:row.room}))); setDuty(schedule.duty.map((row:any)=>({day:row.day,name:row.name}))); setMembers(roster.members) }
  useEffect(() => { reload().catch(e => onError(e.message)) }, [])
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); try { await api('/class/schedule', { method: 'PUT', body: JSON.stringify({ timetable, duty }) }); await reload(); onNotify('课表和值日安排已保存') } catch(e) { onError((e as Error).message) } finally { setBusy(false) } }
  async function importCsv(e: FormEvent) { e.preventDefault(); setBusy(true); try { setReport(await post('/class/schedule/import', csv)); await reload(); onNotify('导入完成，请核对结果') } catch(e) { onError((e as Error).message) } finally { setBusy(false) } }
  return <section className="panel"><h3><CalendarDays size={19} />课程表和值日安排</h3><p className="muted">按星期设置重复安排。值日成员从本班在册成员中选择。</p><form onSubmit={save}><h4>课程表</h4>{timetable.map((row,i)=><div className="form-grid" key={i}><label>星期<select value={row.day} onChange={e=>setTimetable(timetable.map((r,j)=>j===i?{...r,day:e.target.value}:r))}>{days.map(d=><option key={d}>{d}</option>)}</select></label><label>时间<input required value={row.time} placeholder="08:00-09:40" onChange={e=>setTimetable(timetable.map((r,j)=>j===i?{...r,time:e.target.value}:r))}/></label><label>课程<input required value={row.course} onChange={e=>setTimetable(timetable.map((r,j)=>j===i?{...r,course:e.target.value}:r))}/></label><label>教室<input value={row.room} onChange={e=>setTimetable(timetable.map((r,j)=>j===i?{...r,room:e.target.value}:r))}/></label><Button type="button" variant="ghost" onClick={()=>setTimetable(timetable.filter((_,j)=>j!==i))}><X size={16}/></Button></div>)}<Button type="button" variant="outline" onClick={()=>setTimetable([...timetable,{day:'周一',time:'',course:'',room:''}])}><Plus size={15}/>添加课程</Button><h4>值日安排</h4>{duty.map((row,i)=><div className="form-grid" key={i}><label>星期<select value={row.day} onChange={e=>setDuty(duty.map((r,j)=>j===i?{...r,day:e.target.value}:r))}>{days.map(d=><option key={d}>{d}</option>)}</select></label><label>成员<select value={row.name} onChange={e=>setDuty(duty.map((r,j)=>j===i?{...r,name:e.target.value}:r))}><option value="">选择成员</option>{members.map(m=><option key={m.id} value={m.nickname}>{m.nickname}</option>)}</select></label><Button type="button" variant="ghost" onClick={()=>setDuty(duty.filter((_,j)=>j!==i))}><X size={16}/></Button></div>)}<Button type="button" variant="outline" onClick={()=>setDuty([...duty,{day:'周一',name:''}])}><Plus size={15}/>添加值日成员</Button><div className="editor-footer"><span>{timetable.length} 节课程 · {duty.length} 条值日记录</span><Button busy={busy} type="submit">保存安排</Button></div></form><form onSubmit={importCsv} className="spaced"><h4>CSV 导入</h4><label>课程表 CSV<textarea rows={3} value={csv.timetable} onChange={e=>setCsv({...csv,timetable:e.target.value})} placeholder={'day,time,course,room\n周一,08:00-09:40,高等数学,教3102'}/></label><label>值日 CSV<textarea rows={3} value={csv.duty} onChange={e=>setCsv({...csv,duty:e.target.value})} placeholder={'day,name\n周一,张三'}/></label><Button busy={busy} type="submit" variant="outline">导入有效行</Button></form>{report && <div role="status"><p>课程表：导入 {report.timetable.imported} 行，失败 {report.timetable.failed} 行。值日：导入 {report.duty.imported} 行，失败 {report.duty.failed} 行。</p>{[...report.timetable.errors,...report.duty.errors].map((err:any,i:number)=><p key={i}>第 {err.line} 行：{err.reason}</p>)}</div>}</section>
}

function MemberManagement({ onError, currentId, accessRole, onSessionRevoked }: { onError: (s: string) => void; currentId: string; accessRole: 'faculty' | 'cadre'; onSessionRevoked: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [text, setText] = useState('')
  const [pendingMember, setPendingMember] = useState<{ member: Member; role: 'cadre' | 'student' | null; reset?: boolean } | null>(null)
  async function confirmMemberChange() { if(!pendingMember)return;setBusy(true);try {await api(`/class/members/${pendingMember.member.id}${pendingMember.reset?'/reset-password':''}`,{method:pendingMember.reset?'POST':pendingMember.role?'PATCH':'DELETE',...(pendingMember.role?{body:JSON.stringify({role:pendingMember.role})}:{})});if(pendingMember.member.id===currentId)onSessionRevoked();else await reload();setPendingMember(null)}catch(e){onError((e as Error).message)}finally{setBusy(false)} }
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; failed: number; errors: { line: number; reason: string }[] } | null>(null)
  const reload = () => api<{ members: Member[] }>('/members').then(v => setMembers(v.members))
  useEffect(() => { reload().catch(e => onError(e.message)) }, [])
  async function importRoster(e: FormEvent) { e.preventDefault(); setBusy(true); setResult(null); try { setResult(await post('/class/members/import', { text })); await reload() } catch(e) { onError((e as Error).message) } finally { setBusy(false) } }
  return <section className="panel"><h3><Users size={19} />成员管理</h3><p className="muted">每行：姓名,学号,角色,备注。学号必填，角色默认学生。成员须用学号和邀请码激活。</p><form onSubmit={importRoster}><label>上传 CSV<input type="file" accept=".csv,text/csv" onChange={async e => { const file=e.target.files?.[0]; if(!file)return; if(file.size>60000){onError('文件最多60KB');return} setText(await file.text()); setResult(null) }} /></label><label>名单<textarea rows={6} required maxLength={60000} placeholder={'name,student_no,role,note\n张三,20260610751,学生,'} value={text} onChange={e=>setText(e.target.value)} /></label><Button busy={busy} type="submit">导入成员</Button></form>{result && <div role="status"><p>成功 {result.imported} 人，跳过 {result.skipped} 人，失败 {result.failed} 人</p>{result.errors.map((e,i)=><p key={i}>第 {e.line} 行：{e.reason}</p>)}</div>}<div>{members.map(m=><div className="management-row" key={m.id}><span><strong>{m.nickname}</strong><small>{m.studentNo ? `${m.studentNo.slice(0,6)}****` : '无学号'} · {m.role === 'faculty' ? '辅导员' : m.role === 'cadre' ? '班干部' : '学生'} · {m.passwordActive ? '已激活' : '待激活'}{m.note ? ` · ${m.note}` : ''}</small></span><div>{accessRole === 'faculty' && m.role !== 'faculty' && <Button variant="ghost" disabled={busy} onClick={()=>setPendingMember({member:m,role:m.role==='cadre'?'student':'cadre'})}>{m.role==='cadre'?'撤免班干部':'设为班干部'}</Button>}{m.role !== 'faculty' && (accessRole === 'faculty' || m.role === 'student') && <><Button variant="ghost" disabled={busy} onClick={()=>setPendingMember({member:m,role:null,reset:true})}>重置密码</Button><Button variant="ghost" disabled={busy} onClick={()=>setPendingMember({member:m,role:null})}>移出班级</Button></>}</div></div>)}</div>{pendingMember && <Modal title={pendingMember.reset?'重置成员密码？':pendingMember.role?'修改成员角色？':'移出班级？'} onClose={()=>setPendingMember(null)}><p>{pendingMember.member.nickname}：{pendingMember.reset?'现有密码将失效，须重新用学号和邀请码激活。':pendingMember.role?(pendingMember.role==='cadre'?'设为班干部，获得班级管理权限。':'撤免班干部，改为学生。'):'移出后不能登录，已有通知及历史记录保留。'}</p><p className="muted">该成员的现有登录将失效。</p><div className="button-row"><Button variant="outline" onClick={()=>setPendingMember(null)}>取消</Button><Button busy={busy} variant={pendingMember.role?'primary':'danger'} onClick={confirmMemberChange}>确认</Button></div></Modal>}</section>
}
