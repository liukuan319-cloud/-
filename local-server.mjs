import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Same Worker app and migrations; this adapter is only for machines unable to run workerd.
mkdirSync('.local',{recursive:true});
await build({entryPoints:['server/index.ts'],outfile:'.local/worker.mjs',bundle:true,platform:'node',format:'esm',target:'node24',logLevel:'warning'});
const {default:app}=await import(pathToFileURL(resolve('.local/worker.mjs')).href+'?t='+Date.now());
const database=new DatabaseSync('.local/class-ai.sqlite');
database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY);');
for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()){
 if(!database.prepare('SELECT name FROM local_migrations WHERE name=?').get(file)){
  database.exec('BEGIN');try{database.exec(readFileSync(resolve('migrations',file),'utf8'));database.prepare('INSERT INTO local_migrations VALUES(?)').run(file);database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}
 }
}
class Prepared {
 constructor(sql,params=[]){this.sql=sql;this.params=params;}
 bind(...args){return new Prepared(this.sql,args);}
 async first(column){const row=database.prepare(this.sql).get(...this.params);return row?(column?row[column]:row):null;}
 async all(){return {success:true,results:database.prepare(this.sql).all(...this.params),meta:{}};}
 runSync(){const result=database.prepare(this.sql).run(...this.params);return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
 async run(){return this.runSync();}
}
const DB={prepare:sql=>new Prepared(sql),batch:async stmts=>{database.exec('BEGIN');try{const results=stmts.map(s=>s.runSync());database.exec('COMMIT');return results;}catch(e){database.exec('ROLLBACK');throw e;}}};
const config={};
if(existsSync('.dev.vars'))for(const line of readFileSync('.dev.vars','utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)\s*=\s*(.*)$/);if(m)config[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
for(const k of ['AI_API_KEY','API_KEY','AI_BASE_URL','API_BASE','AI_MODEL','MODEL'])if(process.env[k])config[k]=process.env[k];
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
const root=resolve('dist');
const ASSETS={fetch:async req=>{let file=resolve(root,'.'+decodeURIComponent(new URL(req.url).pathname));if(!file.startsWith(root+sep)&&file!==root)return new Response('Forbidden',{status:403});if(!existsSync(file)||statSync(file).isDirectory())file=resolve(root,'index.html');if(!existsSync(file))return new Response('Run pnpm build first.',{status:503});return new Response(readFileSync(file),{headers:{'Content-Type':mime[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'}});}};
const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';
createServer((incoming,outgoing)=>{
 const run=async()=>{
  const chunks=[];let size=0;for await(const chunk of incoming){size+=chunk.length;if(size>64000){outgoing.writeHead(413);outgoing.end('Request too large');return;}chunks.push(chunk);}
  const headers=new Headers();for(const [k,v] of Object.entries(incoming.headers)){if(v)headers.set(k,Array.isArray(v)?v.join(','):v);}
  headers.set('CF-Connecting-IP',incoming.socket.remoteAddress||'local');
  const req=new Request(`http://${incoming.headers.host||`127.0.0.1:${port}`}${incoming.url}`,{method:incoming.method,headers,...(['GET','HEAD'].includes(incoming.method)?{}:{body:Buffer.concat(chunks)})});
  const response=await app.fetch(req,{DB,ASSETS,...config});outgoing.statusCode=response.status;for(const [k,v]of response.headers)if(k!=='set-cookie')outgoing.setHeader(k,v);const cookies=response.headers.getSetCookie();if(cookies.length)outgoing.setHeader('Set-Cookie',cookies);
  if(response.body){const reader=response.body.getReader();while(true){const {value,done}=await reader.read();if(done)break;outgoing.write(value);}}outgoing.end();
 };
 run().catch(e=>{console.error('Local request failed:',e.message);if(!outgoing.headersSent)outgoing.writeHead(500,{'Content-Type':'application/json'});outgoing.end(JSON.stringify({error:'本地服务错误'}));});
}).listen(port,host,()=>console.log(`Class AI ready: http://${host}:${port} (persistent SQLite; ${(config.AI_API_KEY||config.API_KEY)?'model configured':'no model key'})`));
