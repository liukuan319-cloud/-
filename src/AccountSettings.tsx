import { useEffect, useRef, useState } from 'react'
import { LockKeyhole, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { api, post } from './api'
import type { Session } from './api'

export function AccountSettings({ session, onSession, onNotify, onError, onLogout }: {session:Session;onSession:(session:Session)=>void;onNotify:(message:string)=>void;onError:(message:string)=>void;onLogout:()=>void}) {
  const [name,setName]=useState(session.classroom.name)
  const [currentPassword,setCurrentPassword]=useState('')
  const [newPassword,setNewPassword]=useState('')
  const [confirmation,setConfirmation]=useState('')
  const [resetOpen,setResetOpen]=useState(false)
  const [busy,setBusy]=useState(false)
  const [members,setMembers]=useState<Array<{id:string;nickname:string;passwordActive:number;role:string}>>([])
  const [successor,setSuccessor]=useState('')
  const [successorUsername,setSuccessorUsername]=useState('')
  const [transferOpen,setTransferOpen]=useState(false)
  const dialog=useRef<HTMLDialogElement>(null)
  useEffect(()=>{if(resetOpen)dialog.current?.showModal();else dialog.current?.close()},[resetOpen])
  useEffect(()=>{if(session.user.accessRole==='faculty')api<{members:typeof members}>('/members').then(value=>setMembers(value.members)).catch(error=>onError(error.message))},[session.user.id,session.user.accessRole])
  async function run(task:()=>Promise<void>){setBusy(true);try{await task()}catch(error){onError((error as Error).message)}finally{setBusy(false)}}
  return <>
    <section className="panel account-settings"><h3><LockKeyhole size={19}/>账号安全</h3><div className="account-form"><label>当前密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)}/></label><label>新密码<input type="password" autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)} placeholder="8-20位，包含字母和数字"/></label><button className="btn primary" disabled={busy||!currentPassword||!newPassword} onClick={()=>run(async()=>{await api('/session/password',{method:'PUT',body:JSON.stringify({currentPassword,newPassword})});setCurrentPassword('');setNewPassword('');onNotify('密码已更新')})}>修改密码</button></div></section>
    {session.user.accessRole==='faculty' && <section className="panel account-settings"><h3><Pencil size={19}/>班级设置</h3><div className="account-form"><label>班级名称<input value={name} onChange={event=>setName(event.target.value)}/></label><button className="btn primary" disabled={busy||!name.trim()||name===session.classroom.name} onClick={()=>run(async()=>{await api('/class/settings',{method:'PATCH',body:JSON.stringify({name})});onSession({...session,classroom:{...session.classroom,name}});onNotify('班级名称已更新')})}>保存名称</button></div><div className="setting-row"><div><strong>变更辅导员</strong><p>新辅导员须已激活账号。移交后原账号停用，双方须重新登录。</p></div><button className="btn outline" disabled={!members.some(member=>member.id!==session.user.id&&member.passwordActive)} onClick={()=>setTransferOpen(true)}>移交</button></div><div className="setting-row"><div><strong>清空本班数据</strong><p>保留班级与辅导员；指定班级会重新导入 50 人名单、课表和校历。</p></div><button className="btn danger" onClick={()=>setResetOpen(true)}><Trash2 size={15}/>清空</button></div></section>}
    {transferOpen&&<div className="modal-backdrop"><div className="modal transfer-dialog" role="dialog" aria-modal="true" aria-label="变更辅导员"><div className="modal-head"><h2>变更辅导员</h2><button aria-label="关闭" onClick={()=>setTransferOpen(false)}>×</button></div><label>接任成员<select value={successor} onChange={event=>setSuccessor(event.target.value)}><option value="">选择已激活成员</option>{members.filter(member=>member.id!==session.user.id&&member.passwordActive).map(member=><option key={member.id} value={member.id}>{member.nickname}</option>)}</select></label><label>新辅导员账号<input value={successorUsername} onChange={event=>setSuccessorUsername(event.target.value)} placeholder="英文字母开头，至少4位"/></label><p>确认后原辅导员账号停用；接任者使用这个用户名和原密码登录。</p><div className="button-row"><button className="btn outline" onClick={()=>setTransferOpen(false)}>取消</button><button className="btn danger" disabled={busy||!successor||!successorUsername} onClick={()=>run(async()=>{await post('/class/faculty/transfer',{memberId:successor,username:successorUsername});setTransferOpen(false);onLogout()})}>确认移交</button></div></div></div>}
    <dialog ref={dialog} className="modal" onCancel={()=>setResetOpen(false)}><div className="modal-head"><h2>清空本班数据</h2><button aria-label="关闭" onClick={()=>setResetOpen(false)}>×</button></div><p>将清空本班全部数据，不可恢复，确定？</p><label>输入“清空本班数据”确认<input value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label><div className="button-row"><button className="btn outline" onClick={()=>setResetOpen(false)}>取消</button><button className="btn danger" disabled={busy||confirmation!=='清空本班数据'} onClick={()=>run(async()=>{await post('/class/reset',{confirmation});setResetOpen(false);onNotify('班级数据已重建');location.reload()})}><RotateCcw size={15}/>确认清空</button></div></dialog>
  </>
}
