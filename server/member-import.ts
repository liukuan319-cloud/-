import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Identity } from './types';
import { admin, hash, now, secret, uuid } from './auth';

// CSV supports quoted commas/newlines, escaped quotes, CRLF, BOM and tab-separated paste.
export function parseRoster(text:string) {
 const rows:{line:number;cells:string[]}[]=[];
 const source=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 const delimiter=source.split('\n')[0].includes('\t')?'\t':',';
 let cells:string[]=[],cell='',quoted=false,closed=false,line=1,start=1;
 for(let i=0;i<=source.length;i++){
  const ch=source[i];
  if(quoted){if(ch===undefined)throw new HTTPException(400,{message:`第 ${start} 行引号未闭合。`});if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=ch;if(ch==='\n')line++;}continue;}
  if(ch==='"'){if(cell.trim()||closed)throw new HTTPException(400,{message:`第 ${line} 行引号格式错误。`});cell='';quoted=true;continue;}
  if(ch===delimiter||ch==='\n'||ch===undefined){cells.push(cell.trim());cell='';closed=false;if(ch!==delimiter){if(cells.some(Boolean))rows.push({line:start,cells});cells=[];if(ch==='\n')line++;start=line;}continue;}
  if(closed&&ch.trim())throw new HTTPException(400,{message:`第 ${line} 行引号后有多余内容。`});
  cell+=ch;
 }
 return rows;
}
const rowSchema=z.object({name:z.string().min(1,'姓名不能为空').max(24,'姓名最多24字'),student_no:z.string().max(64,'学号最多64字'),role:z.enum(['','成员','班干部','student','admin'],{error:'角色必须为班干部或成员'}),note:z.string().max(500,'备注最多500字')});
export async function importMembers(env:Env,id:Identity,input:unknown){
 admin(id);
 const {text}=z.object({text:z.string().trim().min(1,'请粘贴名单或上传CSV').max(60000,'名单内容过长')}).parse(input);
 const rows=parseRoster(text);if(!rows.length)throw new HTTPException(400,{message:'名单不能为空。'});
 const aliases:Record<string,string>={name:'name',姓名:'name',student_no:'student_no',学号:'student_no',role:'role',角色:'role',note:'note',备注:'note'};
 let columns=['name','student_no','role','note'];
 if(aliases[rows[0].cells[0]]==='name'){
  columns=rows.shift()!.cells.map(v=>aliases[v]);
  if(columns.some(v=>!v)||new Set(columns).size!==columns.length)throw new HTTPException(400,{message:'表头须为 name,student_no,role,note（或姓名,学号,角色,备注），不可重复。'});
 }
 if(rows.length>500)throw new HTTPException(400,{message:'每次最多导入500人。'});
 const existing=(await env.DB.prepare('SELECT nickname,student_no FROM members WHERE class_id=?').bind(id.user.classId).all<{nickname:string;student_no:string|null}>()).results;
 const names=new Set(existing.map(m=>m.nickname)),numbers=new Set(existing.map(m=>m.student_no).filter(Boolean));
 const errors:{line:number;reason:string;kind:'skipped'|'failed'}[]=[],statements:D1PreparedStatement[]=[];
 for(const row of rows){
  const parsed=rowSchema.safeParse(Object.assign({name:'',student_no:'',role:'',note:''},Object.fromEntries(columns.map((k,i)=>[k,row.cells[i]||'']))));
  if(row.cells.length>columns.length||!parsed.success){errors.push({line:row.line,reason:row.cells.length>columns.length?'列数超出表头':parsed.error!.issues.map(i=>i.message).join('；'),kind:'failed'});continue;}
  const r=parsed.data;
  const duplicate=r.student_no&&numbers.has(r.student_no)?'学号已存在':names.has(r.name)?'姓名已存在':'';
  if(duplicate){errors.push({line:row.line,reason:duplicate,kind:'skipped'});continue;}
  names.add(r.name);if(r.student_no)numbers.add(r.student_no);
  statements.push(env.DB.prepare('INSERT INTO members(id,class_id,nickname,student_no,role,note,recovery_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(uuid(),id.user.classId,r.name,r.student_no||null,['admin','班干部'].includes(r.role)?'admin':'student',r.note,await hash(secret()),now()));
 }
 if(statements.length)await env.DB.batch(statements);
 return {total:rows.length,imported:statements.length,skipped:errors.filter(e=>e.kind==='skipped').length,failed:errors.filter(e=>e.kind==='failed').length,errors};
}
