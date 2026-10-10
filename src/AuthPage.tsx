import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, LockKeyhole, Sparkles } from 'lucide-react'
import { post } from './api'
import type { Session } from './api'

type Mode = 'login' | 'activate' | 'create'

export function AuthPage({ onSignIn }: { onSignIn: (session: Session) => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [values, setValues] = useState({ account: '', password: '', confirmPassword: '', studentNo: '', inviteCode: '', name: '', nickname: '', username: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const field = (key: keyof typeof values, label: string, type = 'text', placeholder = '') => <label key={key}>{label}<input required type={type} value={values[key]} placeholder={placeholder} autoComplete={type === 'password' ? mode === 'login' ? 'current-password' : 'new-password' : 'off'} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} /></label>
  function switchMode(next: Mode) { setMode(next); setError('') }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (mode === 'activate' && values.password !== values.confirmPassword) { setError('两次密码不一致。'); return }
    setBusy(true); setError('')
    try {
      const body = mode === 'login' ? { account: values.account, password: values.password }
        : mode === 'activate' ? { studentNo: values.studentNo, inviteCode: values.inviteCode, password: values.password, confirmPassword: values.confirmPassword }
        : { name: values.name, nickname: values.nickname, username: values.username, password: values.password }
      onSignIn(await post<Session>(mode === 'login' ? '/login' : mode === 'activate' ? '/activate' : '/classes', body))
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  return <div className="auth-page"><header className="auth-header"><span className="auth-logo"><Sparkles size={22} />班枢</span><span>班级事务空间</span></header><main className="auth-main"><section className="auth-copy"><span>班级事务 AI 助手</span><h1>让每一天的班务<br />都有清晰的下一步。</h1><p>通知、课表、考试、待办和提醒，都在同一个班级空间。</p></section><section className="auth-panel"><div className="auth-icon"><LockKeyhole size={22} /></div><p className="auth-eyebrow">欢迎回来</p><h2>{mode === 'login' ? '登录班级空间' : mode === 'activate' ? '激活你的账号' : '创建班级空间'}</h2><p className="auth-help">{mode === 'activate' ? '使用名单中的学号和班级邀请码，设置自己的密码。' : mode === 'create' ? '创建后你将成为该班辅导员，并获得独立邀请码。' : '使用学号或辅导员账号登录。'}</p><form onSubmit={submit}>
    {mode === 'login' && <>{field('account', '账号', 'text', '学号或辅导员账号')}{field('password', '密码', 'password', '输入密码')}</>}
    {mode === 'activate' && <>{field('studentNo', '学号', 'text', '名单中的学号')}{field('inviteCode', '班级邀请码', 'text', '向辅导员获取')}{field('password', '设置密码', 'password', '8-20位，包含字母和数字')}{field('confirmPassword', '确认密码', 'password', '再次输入密码')}</>}
    {mode === 'create' && <>{field('name', '班级名称', 'text', '例如：材料科学与工程')}{field('nickname', '辅导员姓名', 'text', '你的姓名')}{field('username', '辅导员账号', 'text', '英文字母开头，至少4位')}{field('password', '设置密码', 'password', '8-20位，包含字母和数字')}</>}
    {error && <p className="auth-error" role="alert">{error}</p>}<button className="auth-submit" type="submit" disabled={busy}>{busy ? '正在处理…' : mode === 'login' ? '登录' : mode === 'activate' ? '激活并登录' : '创建班级'}<ArrowRight size={18} /></button>
  </form><div className="auth-links">{mode !== 'login' && <button onClick={() => switchMode('login')}>返回登录</button>}{mode !== 'activate' && <button onClick={() => switchMode('activate')}>首次使用？用学号和邀请码激活</button>}{mode !== 'create' && <button onClick={() => switchMode('create')}>创建班级</button>}</div></section></main></div>
}
