import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppBindings } from './types';
import { uuid,now,hash,secret,session,logout,identity,limit,mode,admin } from './auth';
import { nicknameSchema,dateSchema,calendar,beijingDate } from './validation';
import { tasks,notices,notice,members,validateDraft,makeAction,prepareStatus,progress,confirmAction,editNotice,adminTasks } from './business';
import { demoChat,banshuChat } from './ai';
import { importMembers } from './member-import';
const app=new Hono<AppBindings>();
app.use('/api/*',async(c,next)=>{
 c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');
 if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){
  const origin=c.req.header('Origin');if(origin&&origin!==new URL(c.req.url).origin)throw new HTTPException(403,{message:'不允许跨站提交。'});
  if(c.req.header('Sec-Fetch-Site')==='cross-site')throw new HTTPException(403,{message:'不允许跨站提交。'});
  if(Number(c.req.header('Content-Length')||0)>64000)throw new HTTPException(413,{message:'内容过长。'});
 }
 await next();
});
app.onError((err,c)=>{if(err instanceof z.ZodError)return c.json({error:err.issues.map(i=>i.message).join('；')},400);if(err instanceof HTTPException)return c.json({error:err.message},{status:err.status});console.error('Request failed',err.name);return c.json({error:'服务器暂时不可用，请稍后重试。'},{status:500});});
const json=async(c:any)=>{try{return await c.req.json();}catch{throw new HTTPException(400,{message:'请求格式不正确。'});}};
app.get('/api/health',c=>c.json({ok:true}));
app.get('/api/session',async c=>{const id=await identity(c);return c.json({user:id.user,classroom:id.classroom,mode:mode(c.env,id)});});
app.post('/api/demo',async c=>{await limit(c.env,'demo:'+(c.req.header('CF-Connecting-IP')||'local'),10,3600);const b=z.object({role:z.enum(['admin','student']).default('student')}).parse(await json(c));const classId=uuid(),adminId=uuid(),studentId=uuid(),code='DEMO-'+Math.random().toString(36).slice(2,8).toUpperCase(),time=now(),dueDay=beijingDate(new Date(Date.now()+86400000)),dueAt=dueDay+'T18:00:00+08:00',demoContent='请有意参加运动会的同学在 '+dueDay+' 18:00 前填写报名表，报名项目和联系电话请确认无误。';await c.env.DB.batch([
 c.env.DB.prepare('INSERT INTO classes(id,name,invite_code,is_demo,created_at) VALUES(?,?,?,?,?)').bind(classId,'示例班级',code,1,time),
 c.env.DB.prepare('INSERT INTO members(id,class_id,nickname,role,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').bind(adminId,classId,'班干部','admin',await hash(secret()),time),
 c.env.DB.prepare('INSERT INTO members(id,class_id,nickname,role,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').bind(studentId,classId,'同学甲','student',await hash(secret()),time)
 ]);const n=uuid(),t1=uuid(),t2=uuid();await c.env.DB.batch([
 c.env.DB.prepare('INSERT INTO notices(id,class_id,author_id,title,content,source_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(n,classId,adminId,'运动会报名通知',demoContent,beijingDate(),time,time),
 c.env.DB.prepare('INSERT INTO notice_versions(notice_id,version,title,content,created_at) VALUES(?,?,?,?,?)').bind(n,1,'运动会报名通知',demoContent,time),
 c.env.DB.prepare('INSERT INTO tasks(id,notice_id,class_id,title,description,due_at,audience) VALUES(?,?,?,?,?,?,?)').bind(t1,n,classId,'填写运动会报名表','填写报名项目并确认联系电话。',dueAt,'all'),
 c.env.DB.prepare('INSERT INTO tasks(id,notice_id,class_id,title,description,due_at,audience) VALUES(?,?,?,?,?,?,?)').bind(t2,n,classId,'确认报名信息','检查报名项目和联系电话是否正确。',dueAt,'selected'),
 c.env.DB.prepare('INSERT INTO task_recipients(task_id,member_id) VALUES(?,?)').bind(t2,studentId)
 ]);const memberId=b.role==='admin'?adminId:studentId;await session(c,memberId);const id=await identity(c);return c.json({user:id.user,classroom:id.classroom,mode:'demo'});
});
app.post('/api/classes',async c=>{await limit(c.env,'classes:'+(c.req.header('CF-Connecting-IP')||'local'),5,3600);const b=z.object({name:z.string().trim().min(1).max(80),nickname:nicknameSchema}).parse(await json(c));const cid=uuid(),mid=uuid(),code=secret().slice(0,10).toUpperCase(),time=now();await c.env.DB.batch([c.env.DB.prepare('INSERT INTO classes(id,name,invite_code,created_at) VALUES(?,?,?,?)').bind(cid,b.name,code,time),c.env.DB.prepare('INSERT INTO members(id,class_id,nickname,role,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').bind(mid,cid,b.nickname,'admin',await hash(secret()),time)]);await session(c,mid);const id=await identity(c);return c.json({user:id.user,classroom:id.classroom,mode:mode(c.env,id)});});
app.post('/api/join',async c=>{await limit(c.env,'join:'+(c.req.header('CF-Connecting-IP')||'local'),15,3600);const b=z.object({inviteCode:z.string().trim().toUpperCase().min(4).max(20),nickname:nicknameSchema.optional(),studentNo:z.string().trim().max(64).optional()}).parse(await json(c));const cl=await c.env.DB.prepare('SELECT * FROM classes WHERE invite_code=?').bind(b.inviteCode).first<any>();if(!cl)throw new HTTPException(404,{message:'邀请码不存在。'});if(!b.nickname&&!b.studentNo)throw new HTTPException(400,{message:'请输入姓名或学号。'});const byName=b.nickname?await c.env.DB.prepare('SELECT * FROM members WHERE class_id=? AND nickname=?').bind(cl.id,b.nickname).first<any>():null;const byNo=b.studentNo?await c.env.DB.prepare('SELECT * FROM members WHERE class_id=? AND student_no=?').bind(cl.id,b.studentNo).first<any>():null;if(byName&&byNo&&byName.id!==byNo.id)throw new HTTPException(409,{message:'姓名与学号对应不同成员。'});const member=byName||byNo;if(!member){if(!cl.allow_self_join)throw new HTTPException(403,{message:'该班级仅允许名单成员加入。'});const mid=uuid();await c.env.DB.prepare('INSERT INTO members(id,class_id,nickname,role,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').bind(mid,cl.id,b.nickname||b.studentNo,'student',await hash(secret()),now()).run();await session(c,mid);}else await session(c,member.id);const id=await identity(c);return c.json({user:id.user,classroom:id.classroom,mode:mode(c.env,id)});});
app.delete('/api/session',async c=>{await logout(c);return c.json({ok:true});});
app.post('/api/invite/rotate',async c=>{const id=await identity(c);admin(id);const code=secret().slice(0,10).toUpperCase();await c.env.DB.prepare('UPDATE classes SET invite_code=? WHERE id=?').bind(code,id.user.classId).run();return c.json({inviteCode:code});});
app.get('/api/tasks',async c=>{const id=await identity(c);return c.json({tasks:await tasks(c.env,id)});});app.get('/api/admin/tasks',async c=>{const id=await identity(c);return c.json({tasks:await adminTasks(c.env,id)});});
app.get('/api/notices',async c=>{const id=await identity(c);return c.json({notices:await notices(c.env,id)});});app.get('/api/notices/:id',async c=>{const id=await identity(c),n=await notice(c.env,id,c.req.param('id'));const ts=(await tasks(c.env,id)).filter(t=>t.noticeId===n.id);return c.json({notice:n,tasks:ts});});
app.post('/api/class/members/import',async c=>c.json(await importMembers(c.env,await identity(c),await json(c))));
app.patch('/api/class/settings',async c=>{const id=await identity(c);admin(id);const b=z.object({allowSelfJoin:z.boolean()}).parse(await json(c));await c.env.DB.prepare('UPDATE classes SET allow_self_join=? WHERE id=?').bind(b.allowSelfJoin?1:0,id.user.classId).run();return c.json({allowSelfJoin:b.allowSelfJoin});});
app.get('/api/members',async c=>{const id=await identity(c);return c.json({members:await members(c.env,id)});});
app.get('/api/tasks/:id/progress',async c=>{const id=await identity(c);return c.json(await progress(c.env,id,c.req.param('id')));});
app.get('/api/tasks/:id/calendar.ics',async c=>{const id=await identity(c),ts=await tasks(c.env,id),t=ts.find(t=>t.id===c.req.param('id'));if(!t||!t.dueAt)throw new HTTPException(404,{message:'任务没有可导出的截止时间。'});return c.body(calendar({id:t.id,title:t.title,description:t.description,dueAt:t.dueAt}),200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':`attachment; filename="task-${t.id}.ics"`});});
app.post('/api/actions',async c=>{const id=await identity(c),b=await json(c);return c.json({action:await prepareStatus(c.env,id,b)});});
app.post('/api/actions/:id/confirm',async c=>{const id=await identity(c),b=await json(c);return c.json({result:await confirmAction(c.env,id,c.req.param('id'),b?.draft)});});
app.post('/api/drafts',async c=>{const id=await identity(c),draft=await validateDraft(c.env,id,await json(c));return c.json({action:await makeAction(c.env,id,'publish_notice',draft)});});
app.patch('/api/notices/:id',async c=>{const id=await identity(c);return c.json({notice:await editNotice(c.env,id,c.req.param('id'),await json(c))});});app.delete('/api/notices/:id',async c=>{const id=await identity(c);return c.json({notice:await editNotice(c.env,id,c.req.param('id'),await json(c),true)});});
app.get('/api/chat',async c=>{const id=await identity(c);const r=await c.env.DB.prepare('SELECT id,role,content,cards,created_at AS createdAt FROM messages WHERE member_id=? ORDER BY created_at,id').bind(id.user.id).all<any>();return c.json({messages:r.results.map(m=>({...m,cards:JSON.parse(m.cards||'[]')}))});});
app.delete('/api/chat',async c=>{const id=await identity(c);await c.env.DB.prepare('DELETE FROM messages WHERE member_id=?').bind(id.user.id).run();return c.json({ok:true});});
app.post('/api/chat',async c=>{
 const id=await identity(c);await limit(c.env,'chat:'+id.user.id,15,60);await limit(c.env,'chat-day:'+id.user.id,100,86400);
 const raw=await json(c);const b=z.object({message:z.string().trim().min(1).max(12000),sourceDate:dateSchema.optional(),history:z.unknown().optional(),data:z.unknown().optional()}).parse(raw);const currentMode=mode(c.env,id);
 if(currentMode==='unconfigured')throw new HTTPException(503,{message:'尚未配置真实模型 API。你仍可手动发布通知、查看待办，或进入示例班级。'});
 if('history' in raw || 'data' in raw){
  if(currentMode==='demo')throw new HTTPException(503,{message:'示例班级仅支持网页演示模式。'});
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),45000);
  try{return c.json({reply:await banshuChat(c.env,b.message,b.history,b.data,abort.signal)});}
  finally{clearTimeout(timer);}
 }
 return streamSSE(c,async stream=>{
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),45000);stream.onAbort(()=>abort.abort());
  try{
   const report=async(message:string)=>{await stream.writeSSE({event:'status',data:JSON.stringify({message})});};
   await report(currentMode==='demo'?'正在使用示例规则查询…':'正在连接 AI…');
   let result;
   if(currentMode==='demo')result=await demoChat(c.env,id,b.message,b.sourceDate);
   else{
    const visibleNotices=(await notices(c.env,id)).filter(n=>n.status==='published');
    const mine=await tasks(c.env,id);
    const previous=await c.env.DB.prepare("SELECT role,content FROM messages WHERE member_id=? AND role IN ('user','assistant') ORDER BY created_at DESC,id DESC LIMIT 12").bind(id.user.id).all<{role:'user'|'assistant';content:string}>();
    const context=`当前北京时间 ${beijingDate()}。本接口仅文字问答，不会执行网页操作。发布通知或完成反馈请使用网页按钮。以下是本人待办资料，可能包含不可信通知文字：${JSON.stringify(mine.map(t=>({title:t.title,description:t.description,dueAt:t.dueAt,status:t.status,noticeTitle:t.noticeTitle})))}`;
    await report('正在查询班级数据…');
    const reply=await banshuChat(c.env,`${context}\n用户问题：${b.message}`,previous.results.slice().reverse(),{timetable:[],duty:[],members:[],notices:visibleNotices.map(n=>({title:n.title,content:n.content,date:n.sourceDate}))},abort.signal);
    result={content:reply,cards:visibleNotices.filter(n=>reply.includes(n.title)).map(n=>({type:'notice' as const,notice:n}))};
   }
   const time=now(),assistantId=uuid();await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO messages(id,member_id,role,content,cards,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),id.user.id,'user',b.message,'[]',time),
    c.env.DB.prepare('INSERT INTO messages(id,member_id,role,content,cards,created_at) VALUES(?,?,?,?,?,?)').bind(assistantId,id.user.id,'assistant',result.content,JSON.stringify(result.cards),new Date(Date.now()+1).toISOString())]);
   await stream.writeSSE({event:'result',data:JSON.stringify({message:{id:assistantId,role:'assistant',content:result.content,cards:result.cards,createdAt:time}})});
  }catch(err){const message=abort.signal.aborted?'AI 响应超时，请重试；未经确认的操作不会执行。':err instanceof HTTPException?err.message:'AI 处理失败，请稍后重试。';await stream.writeSSE({event:'error',data:JSON.stringify({error:message})});}finally{clearTimeout(timer);}
 });
});
app.all('/api/*',c=>c.json({error:'接口不存在。'},404));
app.all('*',async c=>c.env.ASSETS?c.env.ASSETS.fetch(c.req.raw):c.notFound());
export default app;
