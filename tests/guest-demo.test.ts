import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import app from '../server/index';
import type { Env } from '../server/types';

class Statement {
 constructor(private db:DatabaseSync,private sql:string,private args:unknown[]=[] ){}
 bind(...args:unknown[]){return new Statement(this.db,this.sql,args)}
 async first(){return this.db.prepare(this.sql).get(...this.args as never[])??null}
 async all(){return {results:this.db.prepare(this.sql).all(...this.args as never[])}}
 async run(){const result=this.db.prepare(this.sql).run(...this.args as never[]);return {meta:{changes:Number(result.changes)}}}
}
class D1 {
 db=new DatabaseSync(':memory:');
 constructor(){for(const file of ['0001_initial.sql','0002_members.sql','0003_join_policy.sql','0004_member_removal.sql','0005_timetable_duty.sql','0006_notice_categories.sql','0007_academics.sql','0008_calendar.sql','0009_votes.sql','0010_reminders.sql','0011_accounts.sql','0012_schedule_detail.sql','0013_class_records.sql','0014_guest_demo.sql','0015_guest_demo_seed.sql'])this.db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))}
 prepare(sql:string){return new Statement(this.db,sql)}
 async batch(statements:Statement[]){this.db.exec('BEGIN');try{for(const statement of statements)await statement.run();this.db.exec('COMMIT')}catch(error){this.db.exec('ROLLBACK');throw error}}
}
describe('read-only guest demo',()=>{
 it('opens a fixed seeded classroom, scopes reads, and rejects writes',async()=>{
  const store=new D1(),env={DB:store as unknown as D1Database,API_KEY:'test-key'} as Env;
  const call=(path:string,method='GET',body?:unknown,cookie?:string)=>app.request('https://class.test/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})},env);
  const start=await call('/demo/session','POST',{});expect(start.status).toBe(200);
  const cookie=start.headers.get('set-cookie')!.split(';')[0];
  const session=await (await call('/session','GET',undefined,cookie)).json() as any;
  expect(session.classroom).toMatchObject({id:'demo-class-v1',name:'演示班级',isDemo:true});
  for(const [path,key,size] of [['/notices','notices',7],['/members','members',12],['/votes','votes',2],['/personal-tasks','tasks',4]] as const){const response=await call(path,'GET',undefined,cookie);expect(response.status).toBe(200);expect(((await response.json()) as any)[key]).toHaveLength(size)}
  expect((await call('/class/schedule','GET',undefined,cookie)).status).toBe(200);
  expect((await call('/calendar','GET',undefined,cookie)).status).toBe(200);
  for(const [path,method,body] of [['/votes','POST',{title:'evil'}],['/personal-tasks','POST',{title:'evil'}],['/actions','POST',{taskId:'demo-task-1',status:'completed',version:0}],['/classes','POST',{name:'evil'}],['/class/members/import','POST',{text:'evil'}]] as const)expect((await call(path,method,body,cookie)).status).toBe(403);
  expect(store.db.prepare('SELECT count(*) AS n FROM classes').get()!.n).toBe(1);
  expect((await call('/session','DELETE',undefined,cookie)).status).toBe(200);
  expect((await call('/session','GET',undefined,cookie)).status).toBe(401);
  store.db.close();
 });
 it('uses the real model with demo-only data and blocks management prompts',async()=>{
  const store=new D1(),env={DB:store as unknown as D1Database,API_KEY:'test-key'} as Env;
  const start=await app.request('https://class.test/api/demo/session',{method:'POST'},env),cookie=start.headers.get('set-cookie')!.split(';')[0];
  let captured='';let round=0;vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{captured=options.body;round++;return new Response(JSON.stringify({choices:[{message:round===1?{content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'get_class_info',arguments:'{}'}}]}:{content:'演示班级共有 12 位虚构成员。来源：演示班级数据库。'}}]}),{status:200,headers:{'Content-Type':'application/json'}})}));
  const ask=(message:string)=>app.request('https://class.test/api/chat',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({message})},env);
  const read=await ask('我们班有哪些成员？');expect(read.status).toBe(200);expect(await read.text()).toContain('演示班级共有 12 位');expect(captured).toContain('陈老师');expect(captured).not.toContain('材料科学与工程');
  const blocked=await ask('帮我发布通知');expect(await blocked.text()).toContain('演示模式仅支持查看和问答');
  expect(store.db.prepare('SELECT count(*) AS n FROM actions').get()!.n).toBe(0);
  vi.unstubAllGlobals();store.db.close();
 });
});
