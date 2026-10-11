import { useEffect, useState } from 'react'
import { api, post, formatDate, beijingISOString } from './api'
import type { Session } from './api'

type RecordKind = 'assignment' | 'fee' | 'activity' | 'shift'
type RecordRow = { id: string; kind: RecordKind; title: string; detail: string; eventAt: string | null; dueAt: string | null; amountCents: number | null; feeDirection: 'income' | 'expense' | null }
const labels: Record<RecordKind, string> = { assignment: '作业安排', fee: '班费', activity: '班级活动', shift: '值班安排' }

export function ClassRecordsPage({ session, onError }: { session: Session; onError: (message: string) => void }) {
  const [rows, setRows] = useState<RecordRow[]>([])
  const [kind, setKind] = useState<RecordKind>('assignment')
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [eventAt, setEventAt] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [amount, setAmount] = useState('')
  const [feeDirection, setFeeDirection] = useState<'income' | 'expense'>('expense')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const reload = async () => setRows((await api<{ records: RecordRow[] }>('/class/records')).records)
  useEffect(() => { void reload().catch(error => onError(error.message)) }, [session.user.id])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setNotice('')
    try {
      await post('/class/records', { kind, title, detail, eventAt: beijingISOString(eventAt), dueAt: beijingISOString(dueAt), amountCents: kind === 'fee' ? Math.round(Number(amount) * 100) : null, feeDirection: kind === 'fee' ? feeDirection : null })
      setTitle(''); setDetail(''); setEventAt(''); setDueAt(''); setAmount('')
      await reload(); setNotice('已保存到班级事务记录，现在可以直接问 AI。')
    } catch (error) { onError((error as Error).message) } finally { setBusy(false) }
  }
  return <div className="standard-page class-records-page"><div className="page-heading"><h1>班级事务记录</h1><p>录入后，班枢可以回答作业、班费、活动和值班问题。</p></div>
    <section className="panel"><h2>已录入记录</h2>{rows.length ? rows.map(row => <div className="management-row" key={row.id}><div><strong>{row.title}</strong><small>{labels[row.kind]}{row.eventAt ? ` · 时间 ${formatDate(row.eventAt)}` : ''}{row.dueAt ? ` · 截止 ${formatDate(row.dueAt)}` : ''}{row.amountCents !== null ? ` · ${row.feeDirection === 'income' ? '收入' : '支出'} ¥${(row.amountCents / 100).toFixed(2)}` : ''}</small><p>{row.detail}</p></div></div>) : <p className="muted">暂无事务记录，可由班干部在下方录入。</p>}</section>
    {session.user.accessRole !== 'student' && <form className="editor-panel class-record-form" onSubmit={save}><h2>录入班级事务</h2><div className="form-grid"><label>类别<select value={kind} onChange={event => setKind(event.target.value as RecordKind)}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>标题<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：军训用品提交" /></label></div><label>具体内容<textarea rows={3} maxLength={4000} value={detail} onChange={event => setDetail(event.target.value)} placeholder="地点、要求、负责人等" /></label><div className="form-grid"><label>活动或值班时间<input type="datetime-local" value={eventAt} onChange={event => setEventAt(event.target.value)} /></label><label>截止时间<input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label></div>{kind === 'fee' && <div className="form-grid"><label>收支方向<select value={feeDirection} onChange={event => setFeeDirection(event.target.value as 'income' | 'expense')}><option value="income">收入</option><option value="expense">支出</option></select></label><label>班费金额（元）<input required type="number" min="0" max="1000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="例如 25.00" /></label></div>}<button className="auth-submit" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存记录'}</button>{notice && <p role="status">{notice}</p>}</form>}
  </div>
}
