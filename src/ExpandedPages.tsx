import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Bell, Check, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { api, post, beijingISOString, formatDate } from './api'
import type { Session } from './api'
import './expanded.css'

type Props = { session: Session; onError: (message: string) => void }
type Course = { id: string; name: string; semester: string; category: string; credits: number; score: number | null }
type Academics = {
  member: { id: string; nickname: string }
  courses: Course[]
  targets: Record<string, number>
  summary: {
    currentSemester: string | null
    current: { gpa: number | null; attemptedCredits: number }
    cumulative: { gpa: number | null; completedCredits: Record<string, number>; totalCompletedCredits: number }
  }
  comprehensive: Array<{ semester: string; scores: Record<string, number | null> }>
}
type Exam = { id: string; name: string; category: string; examAt: string; registrationDeadline: string | null; note: string }
type Event = { id: string; eventDate: string; title: string; note: string }
type Calendar = {
  semesterStart: string | null
  exams: Exam[]
  events: Event[]
  timetable: Array<{ day: string; time: string; course: string; room: string }>
}
type Vote = {
  id: string; title: string; description: string; anonymous: boolean; closesAt: string
  closed: boolean; total: number; ownOptionId: string | null
  options: Array<{ id: string; label: string; votes: number }>
}
type Reminder = { key: string; type: string; message: string; dueDate: string }
type Rule = { type: string; enabled: boolean; daysBefore: number }
const labels: Record<string, string> = {
  required: '必修', elective: '选修', general: '通识', moral: '德育',
  intellectual: '智育', physical: '体育', aesthetic: '美育', labor: '劳育',
  exam: '考试', registration: '报名截止', duty: '值日', task: '任务截止', activity: '活动报名',
}
const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const beijingDay = (value: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value))
const daysAway = (value: string) => Math.ceil((Date.parse(value) - Date.now()) / 86400000)

function Ring({ value, text }: { value: number; text: string }) {
  const ratio = Math.max(0, Math.min(100, value))
  const circumference = 2 * Math.PI * 54
  return <div className="feature-ring" role="img" aria-label={`${text} ${Math.round(ratio)}%`}>
    <svg viewBox="0 0 128 128" aria-hidden="true">
      <defs><linearGradient id="academic-ring"><stop stopColor="#38D39F" /><stop offset="1" stopColor="#2FA98A" /></linearGradient></defs>
      <circle cx="64" cy="64" r="54" className="feature-ring-track" />
      <circle cx="64" cy="64" r="54" className="feature-ring-value"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio / 100)} />
    </svg>
    <div><strong>{Math.round(ratio)}%</strong><small>{text}</small></div>
  </div>
}
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return <section className="feature-panel"><h2>{title}</h2>{children}</section>
}
function Action({ children, busy = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} className={`feature-action ${props.className || ''}`} disabled={props.disabled || busy}>
    {busy ? <><LoaderCircle size={15} className="spin" />处理中</> : children}
  </button>
}
function Empty({ text }: { text: string }) { return <p className="feature-empty">{text}</p> }
function Loading() { return <div className="feature-skeleton" aria-label="加载中"><span /><span /><span /></div> }
function Heading({ title, detail }: { title: string; detail: string }) {
  return <div className="feature-heading"><h1>{title}</h1><p>{detail}</p></div>
}
function useLoad<T>(path: string, onError: (message: string) => void) {
  const [value, setValue] = useState<T | null>(null)
  const load = async () => {
    if (!path) return
    try { setValue(await api<T>(path)) }
    catch (error) { onError((error as Error).message) }
  }
  useEffect(() => { void load() }, [path])
  return [value, load] as const
}
function CsvInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <div className="feature-csv">
    <label>{label}<textarea value={value} onChange={event => onChange(event.target.value)} rows={4} /></label>
    <label>选择 CSV 文件<input type="file" accept=".csv,text/csv,text/plain" onChange={async event => {
      const file = event.target.files?.[0]
      if (file) onChange((await file.text()).replace(/^\uFEFF/, ''))
    }} /></label>
  </div>
}

export function AcademicsPage({ session, onError }: Props) {
  const [roster] = useLoad<{ members: Array<{ id: string; nickname: string }> }>(session.user.role === 'admin' ? '/members' : '', onError)
  const [selected, setSelected] = useState(session.user.id)
  const [data, reload] = useLoad<Academics>(`/academics?memberId=${selected}`, onError)
  const [exams] = useLoad<Calendar>('/calendar', onError)
  const [semester, setSemester] = useState('2026秋')
  const [course, setCourse] = useState('')
  const [credit, setCredit] = useState('2')
  const [score, setScore] = useState('')
  const [category, setCategory] = useState('required')
  const [bulk, setBulk] = useState('')
  const [targets, setTargets] = useState<Record<string, number>>({})
  const [comprehensive, setComprehensive] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState('')
  useEffect(() => { if (data) setTargets(data.targets) }, [data])
  useEffect(() => {
    const current = data?.comprehensive.find(row => row.semester === semester)
    setComprehensive(Object.fromEntries(['moral', 'intellectual', 'physical', 'aesthetic', 'labor']
      .map(key => [key, current?.scores[key]?.toString() ?? ''])))
  }, [data, semester])
  const run = async (task: () => Promise<string | void>) => {
    if (busy) return
    setBusy(true)
    try { const message = await task(); await reload(); setReport(message || '已保存') }
    catch (error) { onError((error as Error).message) }
    finally { setBusy(false) }
  }
  const total = data ? Object.values(data.targets).reduce((sum, count) => sum + count, 0) : 0
  return <div className="feature-page">
    <Heading title="学业中心" detail="绩点、学分和综测只向本人及班干部开放。" />
    {session.user.role === 'admin' && <label className="feature-select">查看成员
      <select value={selected} onChange={event => setSelected(event.target.value)}>
        {roster?.members.map(member => <option key={member.id} value={member.id}>{member.nickname}</option>)}
      </select>
    </label>}
    {!data ? <Loading /> : <>
      <div className="feature-grid">
        <Frame title="学分进度"><div className="feature-row">
          <Ring value={total ? data.summary.cumulative.totalCompletedCredits / total * 100 : 0} text="毕业学分" />
          <div className="feature-metrics">
            <strong>{data.summary.cumulative.totalCompletedCredits} / {total}</strong>
            {['required', 'elective', 'general'].map(key => <p key={key}>{labels[key]} {data.summary.cumulative.completedCredits[key] || 0} / {data.targets[key] || 0}</p>)}
          </div>
        </div></Frame>
        <Frame title="绩点"><div className="feature-stats">
          <div><strong>{data.summary.current.gpa ?? '—'}</strong><span>本学期 GPA</span></div>
          <div><strong>{data.summary.cumulative.gpa ?? '—'}</strong><span>累计 GPA</span></div>
          <div><strong>{data.summary.current.attemptedCredits}</strong><span>本学期学分</span></div>
        </div><small>按四分制、课程学分加权计算。</small></Frame>
      </div>
      <div className="feature-grid">
        <Frame title="最近考试">{exams?.exams.filter(row => Date.parse(row.examAt) >= Date.now()).slice(0, 4).map(row =>
          <div className="feature-list-row" key={row.id}><span><strong>{row.name}</strong><small>{formatDate(row.examAt)} · {row.note || '地点待公布'}</small></span><strong>{daysAway(row.examAt)} 天</strong></div>
        )}{!exams?.exams.some(row => Date.parse(row.examAt) >= Date.now()) && <Empty text="暂无考试安排" />}</Frame>
        <Frame title="课程成绩">{data.courses.length ? data.courses.map(row =>
          <div className="feature-list-row" key={row.id}><span><strong>{row.name}</strong><small>{row.semester} · {labels[row.category]} · {row.credits} 学分</small></span><strong>{row.score ?? '未录入'}</strong></div>
        ) : <Empty text="暂无成绩数据" />}</Frame>
      </div>
      <Frame title="综合测评">{data.comprehensive.length ? data.comprehensive.map(term =>
        <div key={term.semester}><h3>{term.semester}</h3>{Object.entries(term.scores).map(([key, value]) =>
          <div className="feature-score" key={key}><span>{labels[key]}</span><div><i style={{ width: `${value ?? 0}%` }} /></div><strong>{value ?? '—'}</strong></div>
        )}</div>
      ) : <Empty text="暂无综测数据" />}</Frame>
    </>}
    {session.user.role === 'admin' && <Frame title="录入学业数据">
      <div className="feature-form-grid">
        <label>学期<input value={semester} onChange={event => setSemester(event.target.value)} /></label>
        <label>类别<select value={category} onChange={event => setCategory(event.target.value)}>
          {['required', 'elective', 'general'].map(key => <option value={key} key={key}>{labels[key]}</option>)}
        </select></label>
        <label>课程<input value={course} onChange={event => setCourse(event.target.value)} /></label>
        <label>学分<input type="number" min="0.5" max="30" step="0.5" value={credit} onChange={event => setCredit(event.target.value)} /></label>
        <label>成绩<input type="number" min="0" max="100" value={score} onChange={event => setScore(event.target.value)} /></label>
        <Action busy={busy} disabled={!course.trim() || !score} onClick={() => run(async () => {
          const existing = data?.courses.find(row => row.name === course.trim() && row.semester === semester)
          if (existing && (existing.category !== category || existing.credits !== Number(credit))) throw new Error('已有同名课程，学分或类别不同。')
          const courseId = existing?.id ?? (await post<{ id: string }>('/academics/courses', { name: course, semester, category, credits: Number(credit) })).id
          await api('/academics/grades', { method: 'PUT', body: JSON.stringify({ memberId: selected, courseId, score: Number(score) }) })
        })}>保存成绩</Action>
      </div>
      <div className="feature-form-grid"><h3>学分目标</h3>
        {['required', 'elective', 'general'].map(key => <label key={key}>{labels[key]}
          <input type="number" min="0" value={targets[key] ?? 0} onChange={event => setTargets({ ...targets, [key]: Number(event.target.value) })} />
        </label>)}
        <Action busy={busy} onClick={() => run(() => api('/academics/targets', { method: 'PUT', body: JSON.stringify(targets) }))}>保存目标</Action>
      </div>
      <div className="feature-form-grid"><h3>综合测评</h3>
        {['moral', 'intellectual', 'physical', 'aesthetic', 'labor'].map(key => <label key={key}>{labels[key]}
          <input type="number" min="0" max="100" value={comprehensive[key] ?? ''} onChange={event => setComprehensive({ ...comprehensive, [key]: event.target.value })} />
        </label>)}
        <Action busy={busy} onClick={() => run(async () => {
          for (const [module, value] of Object.entries(comprehensive)) {
            await api('/academics/comprehensive', { method: 'PUT', body: JSON.stringify({ memberId: selected, semester, module, score: value === '' ? null : Number(value) }) })
          }
        })}>保存综测</Action>
      </div>
      <CsvInput label="批量成绩 CSV（课程,学分,成绩）" value={bulk} onChange={setBulk} />
      <Action busy={busy} disabled={!bulk.trim()} onClick={() => run(async () => {
        const result = await post<{ imported: number; failed: number; errors: Array<{line:number;reason:string}> }>('/academics/grades/import', { memberId: selected, semester, category, text: bulk })
        return `导入 ${result.imported} 行，失败 ${result.failed} 行${result.errors.length ? '：' + result.errors.map(row => `第${row.line}行${row.reason}`).join('；') : ''}`
      })}>导入成绩</Action>
      {report && <p role="status">{report}</p>}
    </Frame>}
  </div>
}

export function CalendarPage({ session, onError }: Props) {
  const [data, reload] = useLoad<Calendar>('/calendar', onError)
  const [month, setMonth] = useState(today().slice(0, 7))
  const [semesterStart, setSemesterStart] = useState('')
  const [exam, setExam] = useState({ name: '', category: '考试', registrationDeadline: '', examAt: '', note: '' })
  const [event, setEvent] = useState({ eventDate: '', title: '', note: '' })
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => { setSemesterStart(data?.semesterStart ?? '') }, [data?.semesterStart])
  const run = async (task: () => Promise<string | void>) => {
    if (busy) return
    setBusy(true)
    try { const message = await task(); await reload(); setStatus(message || '已保存') }
    catch (error) { onError((error as Error).message) }
    finally { setBusy(false) }
  }
  const first = new Date(`${month}-01T00:00:00Z`)
  const offset = (first.getUTCDay() + 6) % 7
  const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cells = Array.from({ length: offset + length }, (_, index) => index - offset + 1)
  const week = semesterStart ? Math.floor((Date.parse(today() + 'T00:00:00Z') - Date.parse(semesterStart + 'T00:00:00Z')) / 604800000) + 1 : null
  return <div className="feature-page">
    <Heading title="班级日历" detail="考试、校历节点与每周课程，一处查看。" />
    {!data ? <Loading /> : <>
      <div className="feature-grid">
        <Frame title="考试日历">
          <div className="feature-month"><button aria-label="上个月" onClick={() => setMonth(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1)).toISOString().slice(0, 7))}>‹</button><strong>{month}</strong><button aria-label="下个月" onClick={() => setMonth(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)).toISOString().slice(0, 7))}>›</button></div>
          <div className="feature-calendar">{days.map(day => <b key={day}>{day.slice(1)}</b>)}{cells.map((day, index) => <span key={index} className={day > 0 && `${month}-${String(day).padStart(2, '0')}` === today() ? 'today' : ''}>{day > 0 && <>{day}{data.exams.some(row => beijingDay(row.examAt) === `${month}-${String(day).padStart(2, '0')}`) && <i />}</>}</span>)}</div>
          {data.exams.length ? data.exams.map(row => <div className="feature-list-row" key={row.id}>
            <span><strong>{row.name}</strong><small>{formatDate(row.examAt)} · {row.category}{row.note && ` · ${row.note}`}</small>{row.registrationDeadline && <small>报名截止 {formatDate(row.registrationDeadline)}</small>}</span>
            <strong>{Date.parse(row.examAt) < Date.now() ? '已截止' : `${daysAway(row.examAt)} 天`}</strong>
          </div>) : <Empty text="暂无考试安排" />}
        </Frame>
        <Frame title="校历"><strong className="feature-big">{week && week > 0 ? `第 ${week} 周` : '学期未开始'}</strong>
          <p>学期开始：{data.semesterStart || '待设置'}</p>
          {data.events.map(row => <div className="feature-list-row" key={row.id}><strong>{row.eventDate}</strong><span>{row.title}<small>{row.note}</small></span></div>)}
          {!data.events.length && <Empty text="暂无校历节点" />}
        </Frame>
      </div>
      <Frame title="课程表"><div className="feature-timetable">{days.map(day => <div key={day}><h3>{day}</h3>{data.timetable.filter(row => row.day === day).map((row, index) => <p key={index}><strong>{row.course}</strong><small>{row.time} · {row.room || '教室待定'}</small></p>)}{!data.timetable.some(row => row.day === day) && <small>无课</small>}</div>)}</div></Frame>
    </>}
    {session.user.role === 'admin' && <Frame title="管理考试与校历">
      <div className="feature-form-grid">
        <label>考试名称<input value={exam.name} onChange={event => setExam({ ...exam, name: event.target.value })} /></label>
        <label>类别<input value={exam.category} onChange={event => setExam({ ...exam, category: event.target.value })} /></label>
        <label>考试时间<input type="datetime-local" value={exam.examAt} onChange={event => setExam({ ...exam, examAt: event.target.value })} /></label>
        <label>报名截止<input type="datetime-local" value={exam.registrationDeadline} onChange={event => setExam({ ...exam, registrationDeadline: event.target.value })} /></label>
        <label>备注<input value={exam.note} onChange={event => setExam({ ...exam, note: event.target.value })} /></label>
        <Action busy={busy} disabled={!exam.name.trim() || !exam.examAt} onClick={() => run(() => post('/calendar/exams', { ...exam, examAt: beijingISOString(exam.examAt), registrationDeadline: beijingISOString(exam.registrationDeadline) }))}>添加考试</Action>
      </div>
      <div className="feature-form-grid">
        <label>校历日期<input type="date" value={event.eventDate} onChange={e => setEvent({ ...event, eventDate: e.target.value })} /></label>
        <label>节点名称<input value={event.title} onChange={e => setEvent({ ...event, title: e.target.value })} /></label>
        <label>备注<input value={event.note} onChange={e => setEvent({ ...event, note: e.target.value })} /></label>
        <Action busy={busy} disabled={!event.eventDate || !event.title.trim()} onClick={() => run(() => post('/calendar/events', event))}>添加节点</Action>
      </div>
      <div className="feature-form-grid"><label>学期开始日期<input type="date" value={semesterStart} onChange={e => setSemesterStart(e.target.value)} /></label>
        <Action busy={busy} onClick={() => run(() => api('/calendar/semester', { method: 'PUT', body: JSON.stringify({ semesterStart: semesterStart || null }) }))}>保存学期</Action>
      </div>
      <CsvInput label="批量 CSV（考试：名称,类别,报名截止 ISO,考试时间 ISO,备注；节点：日期,名称,备注）" value={csv} onChange={setCsv} />
      <div className="feature-actions">{(['exams', 'events'] as const).map(kind => <Action key={kind} busy={busy} disabled={!csv.trim()} onClick={() => run(async () => {
        const result = await post<{ imported: number; failed: number; errors: Array<{line:number;reason:string}> }>('/calendar/import', { kind, csv })
        return `导入${kind === 'exams' ? '考试' : '节点'} ${result.imported} 行，失败 ${result.failed} 行${result.errors.length ? '：' + result.errors.map(row => `第${row.line}行${row.reason}`).join('；') : ''}`
      })}>导入{kind === 'exams' ? '考试' : '节点'}</Action>)}</div>
      {status && <p role="status">{status}</p>}
    </Frame>}
  </div>
}

export function VotesPage({ session, onError }: Props) {
  const [data, reload] = useLoad<{ votes: Vote[] }>('/votes', onError)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [anonymous, setAnonymous] = useState(true)
  const [closesAt, setClosesAt] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (task: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try { await task(); await reload() }
    catch (error) { onError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="feature-page"><Heading title="投票表决" detail="每位成员一票；匿名投票不保存成员身份。" />
    {session.user.role === 'admin' && <Frame title="发起投票"><form onSubmit={(event: FormEvent) => {
      event.preventDefault()
      void run(() => post('/votes', { title, description, options, anonymous, closesAt: beijingISOString(closesAt) }))
    }}>
      <div className="feature-form-grid"><label>标题<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label><label>截止时间<input required type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} /></label></div>
      <label>说明<textarea value={description} onChange={e => setDescription(e.target.value)} /></label>
      {options.map((option, index) => <div className="feature-option-edit" key={index}><input required placeholder={`选项 ${index + 1}`} value={option} onChange={e => setOptions(options.map((row, i) => i === index ? e.target.value : row))} /><button type="button" aria-label="移除选项" disabled={options.length <= 2} onClick={() => setOptions(options.filter((_, i) => i !== index))}><Trash2 size={16} /></button></div>)}
      <div className="feature-actions"><Action type="button" disabled={options.length >= 12} onClick={() => setOptions([...options, ''])}><Plus size={16} />添加选项</Action><label className="feature-check"><input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} />匿名投票</label><Action type="submit" busy={busy}>发起投票</Action></div>
    </form></Frame>}
    {!data ? <Loading /> : data.votes.length ? data.votes.map(vote => <Frame key={vote.id} title={vote.title}>
      <div className="feature-vote-meta"><span>{vote.anonymous ? '匿名' : '实名'} · {vote.closed ? '已结束' : '进行中'}</span><span>{vote.total} 人已投 · 截止 {formatDate(vote.closesAt)}</span></div>
      <p>{vote.description}</p>{vote.options.map(option => <div key={option.id} className="feature-vote-option"><div><strong>{option.label}</strong><span>{option.votes} 票 · {vote.total ? Math.round(option.votes / vote.total * 100) : 0}%</span></div><div className="feature-bar"><i style={{ width: `${vote.total ? option.votes / vote.total * 100 : 0}%` }} /></div><Action busy={busy} disabled={vote.closed || !!vote.ownOptionId} onClick={() => run(() => post(`/votes/${vote.id}/cast`, { optionId: option.id }))}>{vote.ownOptionId === option.id ? <><Check size={15} />已投此项</> : vote.ownOptionId ? '已投票' : '投一票'}</Action></div>)}
      {session.user.role === 'admin' && !vote.closed && <Action busy={busy} onClick={() => run(() => post(`/votes/${vote.id}/end`, {}))}>结束投票</Action>}
    </Frame>) : <Empty text="暂无投票" />}
  </div>
}

export function RemindersPage({ session, onError }: Props) {
  const [data, reload] = useLoad<{ reminders: Reminder[] }>('/reminders', onError)
  const [rules, setRules] = useState<Rule[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (session.user.role === 'admin') void api<{ rules: Rule[] }>('/reminders/rules').then(value => setRules(value.rules)).catch(error => onError(error.message))
  }, [session.user.role])
  return <div className="feature-page"><Heading title="站内提醒" detail="按北京时间计算，打开班枢即可查看。" />
    <Frame title="我的提醒">{!data ? <Loading /> : data.reminders.length ? data.reminders.map(item => <div className="feature-list-row" key={item.key}><Bell size={18} /><span><strong>{item.message}</strong><small>{labels[item.type]} · {item.dueDate}</small></span></div>) : <Empty text="暂无即将到来的提醒" />}</Frame>
    {session.user.role === 'admin' && <Frame title="提醒管理">{rules.map((rule, index) => <div className="feature-rule" key={rule.type}><label className="feature-check"><input type="checkbox" checked={rule.enabled} onChange={event => setRules(rules.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item))} />{labels[rule.type]}</label><label>提前天数<input type="number" min="0" max="30" value={rule.daysBefore} onChange={event => setRules(rules.map((item, i) => i === index ? { ...item, daysBefore: Number(event.target.value) } : item))} /></label></div>)}<Action busy={busy} onClick={async () => { setBusy(true); try { const result = await api<{ rules: Rule[] }>('/reminders/rules', { method: 'PUT', body: JSON.stringify(rules) }); setRules(result.rules); await reload() } catch (error) { onError((error as Error).message) } finally { setBusy(false) } }}>保存规则</Action></Frame>}
  </div>
}
