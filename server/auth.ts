import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { AppBindings, Env, Identity } from './types';
export const uuid=()=>crypto.randomUUID();
export const now=()=>new Date().toISOString();
export function secret(){const b=crypto.getRandomValues(new Uint8Array(32));return Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');}
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
export async function limit(env:Env,key:string,max:number,seconds=60){
 const bucket=Math.floor(Date.now()/1000/seconds),k=key+':'+bucket;
 const r=await env.DB.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(k,(bucket+1)*seconds).first<{count:number}>();
 if(r&&r.count>max)throw new HTTPException(429,{message:'请求太频繁，请稍后再试。'});
 // Bounded cleanup keeps expired rate buckets from accumulating indefinitely.
 await env.DB.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < ? LIMIT 30)').bind(Math.floor(Date.now()/1000)-3600).run();
}
export async function session(c:Context<AppBindings>,memberId:string){
 const token=secret(),expires=new Date(Date.now()+30*86400000).toISOString();
 await c.env.DB.prepare('INSERT INTO sessions(token_hash,member_id,expires_at) VALUES(?,?,?)').bind(await hash(token),memberId,expires).run();
 setCookie(c,'class_session',token,{httpOnly:true,secure:new URL(c.req.url).protocol==='https:',sameSite:'Strict',path:'/',maxAge:30*86400});
 c.set('identity',await identityForMember(c.env,memberId));
}
export async function logout(c:Context<AppBindings>){const token=getCookie(c,'class_session');if(token)await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run();deleteCookie(c,'class_session',{path:'/'});}
export async function identity(c:Context<AppBindings>):Promise<Identity>{
 const cached=c.get('identity');if(cached)return cached;
 const token=getCookie(c,'class_session');if(!token)throw new HTTPException(401,{message:'请先加入班级。'});
 const row=await c.env.DB.prepare(`SELECT m.id,m.class_id,m.nickname,m.role,m.access_role,c.name,c.invite_code,c.is_demo,c.allow_self_join FROM sessions s JOIN members m ON m.id=s.member_id JOIN classes c ON c.id=m.class_id WHERE m.deleted_at IS NULL AND s.token_hash=? AND s.expires_at>?`).bind(await hash(token),now()).first<any>();
 if(!row)throw new HTTPException(401,{message:'登录已失效，请使用姓名或学号及班级邀请码重新登录。'});
 return {user:{id:row.id,classId:row.class_id,nickname:row.nickname,role:row.role,accessRole:row.access_role},classroom:{id:row.class_id,name:row.name,isDemo:!!row.is_demo,...(row.access_role==='faculty'?{inviteCode:row.invite_code,allowSelfJoin:!!row.allow_self_join}:{})}};
}
export async function identityForMember(env:Env,memberId:string):Promise<Identity>{
 const row=await env.DB.prepare('SELECT m.id,m.class_id,m.nickname,m.role,m.access_role,c.name,c.invite_code,c.is_demo,c.allow_self_join FROM members m JOIN classes c ON c.id=m.class_id WHERE m.deleted_at IS NULL AND m.id=?').bind(memberId).first<any>();
 if(!row)throw new HTTPException(401,{message:'成员不存在。'});
 return {user:{id:row.id,classId:row.class_id,nickname:row.nickname,role:row.role,accessRole:row.access_role},classroom:{id:row.class_id,name:row.name,isDemo:!!row.is_demo,...(row.access_role==='faculty'?{inviteCode:row.invite_code,allowSelfJoin:!!row.allow_self_join}:{})}};
}
export function admin(id:Identity){if((id.user.accessRole || (id.user.role==='admin'?'cadre':'student'))==='student')throw new HTTPException(403,{message:'此操作仅限辅导员或班干部。'});}
export function faculty(id:Identity){if(id.user.accessRole!=='faculty')throw new HTTPException(403,{message:'此操作仅限辅导员。'});}
export function mode(env:Env,id:Identity){return id.classroom.isDemo?'demo':(env.AI_API_KEY||env.API_KEY)?'live':'unconfigured';}
