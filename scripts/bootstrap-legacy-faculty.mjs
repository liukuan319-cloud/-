import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function query(sql) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','d1','execute','class-ai','--remote','--command',sql,'--json'], { encoding:'utf8' });
  if (result.status !== 0) throw new Error(`D1 query failed: ${result.stderr || result.stdout}`);
  const start = result.stdout.indexOf('[\n');
  return JSON.parse(result.stdout.slice(start >= 0 ? start : result.stdout.indexOf('[')))[0]?.results ?? [];
}

const rows=query("SELECT c.id AS classId,m.id AS memberId,m.nickname,m.access_role AS role,m.username FROM classes c JOIN members m ON m.class_id=c.id AND m.deleted_at IS NULL WHERE c.is_demo=0 AND m.role='admin' AND NOT EXISTS(SELECT 1 FROM members f WHERE f.class_id=c.id AND f.deleted_at IS NULL AND f.access_role='faculty') ORDER BY c.id");
if (!rows.length) { console.log('No legacy administrators need bootstrapping.'); process.exit(0); }
const credentials=[];
for (const row of rows) {
  if (row.role !== 'cadre' || row.username) throw new Error('Unexpected legacy administrator state. No further changes made.');
  const username=`faculty_${row.classId.replaceAll('-','').slice(0,12)}`;
  if (query(`SELECT id FROM members WHERE username='${username}' AND deleted_at IS NULL`).length) throw new Error(`Username collision for class ${row.classId}`);
  const password=`Banshu@${randomBytes(12).toString('base64url')}`;
  const salt=randomBytes(16),digest=pbkdf2Sync(password,salt,100000,32,'sha256');
  const hash=`pbkdf2-sha256$100000$${salt.toString('hex')}$${digest.toString('hex')}`;
  query(`UPDATE members SET username='${username}',access_role='faculty',password_hash='${hash}',password_active=1,failed_attempts=0,locked_until=NULL WHERE id='${row.memberId}' AND class_id='${row.classId}' AND access_role='cadre' AND username IS NULL`);
  const verified=query(`SELECT username,access_role AS role,password_active AS active FROM members WHERE id='${row.memberId}' AND class_id='${row.classId}'`);
  if (verified.length!==1 || verified[0].username!==username || verified[0].role!=='faculty' || verified[0].active!==1) throw new Error(`Could not verify class ${row.classId}`);
  credentials.push(`班级 ID：${row.classId}\n原管理员：${row.nickname}\n辅导员账号：${username}\n初始密码：${password}\n`);
}
await mkdir('.local',{recursive:true});
await writeFile('.local/legacy-faculty-credentials.txt',credentials.join('\n'),{mode:0o600});
console.log(`Initialized ${credentials.length} legacy administrators. Credentials are in .local/legacy-faculty-credentials.txt (ignored by Git).`);
