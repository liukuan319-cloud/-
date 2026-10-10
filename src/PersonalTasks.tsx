import { useEffect, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { api, post, beijingISOString, formatDate } from './api'

type PersonalTask = { id:string; title:string; note:string; dueAt:string|null; status:'pending'|'completed' }

export function PersonalTasks({ onError }: { onError:(message:string)=>void }) {
  const [tasks,setTasks]=useState<PersonalTask[]>([])
  const [title,setTitle]=useState('')
  const [note,setNote]=useState('')
  const [dueAt,setDueAt]=useState('')
  const [busy,setBusy]=useState(false)
  const reload=()=>api<{tasks:PersonalTask[]}>('/personal-tasks').then(result=>setTasks(result.tasks))
  useEffect(()=>{reload().catch(error=>onError(error.message))},[])
  async function add(){if(!title.trim()||busy)return;setBusy(true);try{await post('/personal-tasks',{title,note,dueAt:beijingISOString(dueAt)});setTitle('');setNote('');setDueAt('');await reload()}catch(error){onError((error as Error).message)}finally{setBusy(false)}}
  async function toggle(task:PersonalTask){if(busy)return;setBusy(true);try{await api(`/personal-tasks/${task.id}`,{method:'PATCH',body:JSON.stringify({status:task.status==='pending'?'completed':'pending'})});await reload()}catch(error){onError((error as Error).message)}finally{setBusy(false)}}
  return <section className="panel personal-tasks"><h3>我的每日待办</h3><div className="personal-task-form"><input aria-label="待办事项" placeholder="今天要做什么？" maxLength={120} value={title} onChange={event=>setTitle(event.target.value)}/><input aria-label="时间" type="datetime-local" value={dueAt} onChange={event=>setDueAt(event.target.value)}/><input aria-label="备注" placeholder="备注（可选）" maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/><button className="btn primary" disabled={busy||!title.trim()} onClick={add}><Plus size={16}/>添加</button></div><div className="personal-task-list">{tasks.map(task=><div key={task.id} className="personal-task-row"><button className={`check-circle ${task.status==='completed'?'checked':''}`} aria-label={task.status==='completed'?`撤销完成${task.title}`:`完成${task.title}`} disabled={busy} onClick={()=>toggle(task)}>{task.status==='completed'&&<Check size={16}/>}</button><span><strong>{task.title}</strong><small>{task.note}{task.dueAt&&` · ${formatDate(task.dueAt)}`}</small></span></div>)}{!tasks.length&&<p className="muted">今天还没有个人待办。</p>}</div></section>
}
