import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const classId = '818122f3-4665-42b9-b7bb-448ab5a71336';
const localOnly = process.argv.includes('--local');
const scope = localOnly ? '--local' : '--remote';

function query(sql) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'class-ai', scope, '--command', sql, '--json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`D1 query failed: ${result.stderr || result.stdout}`);
  const start = result.stdout.indexOf('[\n');
  const parsed = JSON.parse(result.stdout.slice(start >= 0 ? start : result.stdout.indexOf('[')));
  return parsed[0]?.results ?? [];
}

const members = query(`SELECT id,nickname,student_no,access_role,username FROM members WHERE class_id='${classId}' AND deleted_at IS NULL`);
if (members.length !== 6 || members.filter(member => member.access_role === 'cadre').length !== 1 || members.some(member => member.student_no)) {
  throw new Error('Target class no longer matches the inspected six-member legacy state. No changes made.');
}
const owner = members.find(member => member.access_role === 'cadre');
if (!owner || owner.username) throw new Error('Target faculty has already been initialized. No changes made.');
if (query("SELECT id FROM members WHERE username='luowenjie' AND deleted_at IS NULL").length) throw new Error('The username luowenjie is already in use.');

const password = `Banshu@${randomBytes(12).toString('base64url')}`;
const salt = randomBytes(16);
const digest = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const encoded = `pbkdf2-sha256$100000$${salt.toString('hex')}$${digest.toString('hex')}`;
const update = `UPDATE members SET nickname='罗文杰',username='luowenjie',access_role='faculty',role='admin',student_no=NULL,password_hash='${encoded}',password_active=1,failed_attempts=0,locked_until=NULL WHERE id='${owner.id}' AND class_id='${classId}' AND deleted_at IS NULL AND access_role='cadre' AND username IS NULL`;
query(update);
const verified = query(`SELECT id,username,access_role,password_active FROM members WHERE id='${owner.id}' AND class_id='${classId}'`);
if (verified.length !== 1 || verified[0].username !== 'luowenjie' || verified[0].access_role !== 'faculty' || verified[0].password_active !== 1) throw new Error('Faculty update could not be verified.');
await mkdir('.local', { recursive: true });
await writeFile('.local/initial-faculty-credentials.txt', `班级：材料科学与工程\n辅导员账号：luowenjie\n初始密码：${password}\n请首次登录后立即修改密码。\n`, { mode: 0o600 });
console.log('Faculty initialized. Credentials were written to .local/initial-faculty-credentials.txt (ignored by Git).');
