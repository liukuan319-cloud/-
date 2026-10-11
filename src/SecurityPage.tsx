import { useEffect, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Database, FileClock, Info, ShieldCheck } from 'lucide-react'
import { api } from './api'
import type { Session } from './api'

type Section = 'privacy' | 'sources' | 'audit' | 'about'
interface AuditEntry { id: string; createdAt: string; actorName: string; actorRole: string; description: string }
interface AuditPage { page: number; pageSize: number; total: number; entries: AuditEntry[] }

const sections = [
  { id: 'privacy', label: '隐私与数据说明', icon: ShieldCheck },
  { id: 'sources', label: '数据来源', icon: Database },
  { id: 'audit', label: '操作留痕', icon: FileClock },
  { id: 'about', label: '关于', icon: Info },
] as const

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(date)
}

export function SecurityPage({ session }: { session: Session }) {
  const isFaculty = session.user.accessRole === 'faculty' && !session.classroom.isDemo
  const [section, setSection] = useState<Section>('privacy')
  const [page, setPage] = useState(1)
  const [audit, setAudit] = useState<AuditPage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (section !== 'audit' || !isFaculty) return
    let active = true
    setBusy(true); setError('')
    api<AuditPage>(`/security/audit?page=${page}`).then(result => { if (active) setAudit(result) })
      .catch(cause => { if (active) setError((cause as Error).message) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [section, page, isFaculty])

  return <div className="standard-page security-page">
    <div className="page-heading"><div><span className="eyebrow"><ShieldCheck size={15}/>数据透明与安全</span><h1>设置与安全</h1><p>了解班枢如何使用班级数据，并查看已记录的操作。</p></div></div>
    <nav className="security-tabs" aria-label="设置与安全栏目">{sections.filter(item => item.id !== 'audit' || isFaculty).map(item => <button key={item.id} className={section === item.id ? 'active' : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}><item.icon size={17}/>{item.label}</button>)}</nav>
    {section === 'privacy' && <section className="panel security-panel"><h2><ShieldCheck size={21}/>隐私与数据说明</h2><div className="security-list">
      <article><h3>收集哪些数据</h3><p>为提供班级事务服务，系统保存学号、姓名、班级与角色、登录时间，以及已记录的操作。通知、课表、待办、投票和 AI 对话内容也按对应功能保存。</p></article>
      <article><h3>用于什么</h3><p>数据仅用于本系统的班级事务管理，包括通知、课表、任务、投票与 AI 问答。AI 查询受当前班级和身份权限限制。</p></article>
      <article><h3>如何保护</h3><p>密码使用加盐哈希保存，无法从系统读取明文。成员列表中的学号做遮盖显示；登录有失败次数限制。登录凭证保存在 HttpOnly Cookie 中。</p></article>
      <article><h3>数据边界</h3><p>成员名单由本班提供，并在班级同学知情同意的范围内用于本系统。课表、校历以学校公布的官方安排为来源，由班级管理者录入；具体日期请以学校最新通知为准。不同班级的数据按班级身份隔离。</p></article>
    </div></section>}
    {section === 'sources' && <section className="panel security-panel"><h2><BookOpen size={21}/>数据来源</h2><div className="security-list">
      <article><h3>成员名单</h3><p>本班真实成员名单，经班级同学知情同意后导入和维护。</p></article>
      <article><h3>课表与校历</h3><p>课表依据学校公布的当前学期课程表；校历依据学校公布的 2026—2027 学年第一学期校历。班级管理者录入后在班枢展示。</p></article>
      <article><h3>考证考试与通知</h3><p>考证考试日历和通知内容由辅导员或班干部在系统内发布、维护；回答可回看对应通知或记录。</p></article>
      <article><h3>演示空间</h3><p>演示数据为虚拟数据，仅用于功能演示，与真实班级数据隔离。</p></article>
    </div></section>}
    {section === 'audit' && isFaculty && <section className="panel security-panel"><h2><FileClock size={21}/>操作留痕</h2><p className="security-hint">仅辅导员可查看本班已记录的操作。记录只读；早期未留痕的操作不会补记。</p>
      {error && <p className="security-error" role="alert">{error}</p>}
      {busy && <p className="security-hint" role="status">正在加载操作记录…</p>}
      {!busy && audit && (audit.entries.length ? <div className="security-audit-list">{audit.entries.map(entry => <article key={entry.id}><span className="security-audit-icon"><FileClock size={17}/></span><div><strong>{entry.description}</strong><p>{entry.actorName} · {entry.actorRole}</p></div><time>{formatTime(entry.createdAt)}</time></article>)}</div> : <p className="security-hint">当前页面没有操作记录。</p>)}
      <div className="security-pagination"><span>共 {audit?.total ?? 0} 条 · 第 {page} 页</span><div><button disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16}/>上一页</button><button disabled={busy || !audit || page * audit.pageSize >= audit.total} onClick={() => setPage(value => value + 1)}>下一页<ChevronRight size={16}/></button></div></div>
    </section>}
    {section === 'about' && <section className="panel security-panel security-about"><h2><Info size={21}/>关于班枢</h2><strong>班枢</strong><p>班枢 —— AI 智能体班级事务管理系统</p><div className="security-about-meta"><span>版本</span><b>v1.0.0</b></div><div className="security-about-meta"><span>团队署名</span><b>班枢项目团队</b></div><p className="security-hint">以自然语言查询班级事务，回答有来源，操作可确认，结果可追踪。</p></section>}
  </div>
}
