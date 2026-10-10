import { readFile } from 'node:fs/promises';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const files=['.local/initial-faculty-credentials.txt','.local/legacy-faculty-credentials.txt'];
const entries=[];
for(const file of files){
 const text=await readFile(file,'utf8');
 const accounts=[...text.matchAll(/辅导员账号：([^\r\n]+)\r?\n初始密码：([^\r\n]+)/g)];
 for(const match of accounts)entries.push({username:match[1].trim(),password:match[2].trim()});
}
if(entries.length!==5)throw new Error('Expected five local faculty credentials.');
for(const {username,password} of entries){
 if(!/^[a-z0-9_]{4,32}$/.test(username))throw new Error('Unexpected username.');
 const salt=randomBytes(16),digest=pbkdf2Sync(password,salt,100000,32,'sha256');
 const hash=`pbkdf2-sha256$100000$${salt.toString('hex')}$${digest.toString('hex')}`;
 const sql=`UPDATE members SET password_hash='${hash}',failed_attempts=0,locked_until=NULL WHERE username='${username}' AND access_role='faculty' AND deleted_at IS NULL AND password_hash LIKE 'pbkdf2-sha256$210000$%'`;
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','class-ai','--remote','--command',sql,'--json'],{encoding:'utf8'});
 if(result.status!==0)throw new Error(`Could not update ${username}`);
 const start=result.stdout.indexOf('[\n');const parsed=JSON.parse(result.stdout.slice(start>=0?start:result.stdout.indexOf('[')));
 if(parsed[0]?.meta?.changes!==1)throw new Error(`Unexpected update count for ${username}`);
}
console.log(`Rehashed ${entries.length} faculty accounts for the Worker-compatible PBKDF2 limit.`);
