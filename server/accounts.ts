import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env } from './types';
import { now } from './auth';

export const passwordSchema = z.string().min(8).max(20).regex(/^(?=.*[A-Za-z])(?=.*\d)/, '密码须包含字母和数字');
export const studentNoSchema = z.string().trim().min(1).max(64);
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{3,31}$/, '账号须为4至32位英文字母、数字或下划线');
const PASSWORD_ITERATIONS=100000;

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const digest = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, material, 256));
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${hex(salt)}$${hex(digest)}`;
}

function hex(bytes: Uint8Array) { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
function unhex(value: string) { return Uint8Array.from(value.match(/.{2}/g) || [], part => parseInt(part, 16)); }

export async function verifyPassword(password: string, encoded: string | null) {
  const parts = encoded?.split('$');
  if (!parts || parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== String(PASSWORD_ITERATIONS) || !/^[0-9a-f]{32}$/.test(parts[2]) || !/^[0-9a-f]{64}$/.test(parts[3])) return false;
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const digest=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(parts[2]),iterations:PASSWORD_ITERATIONS},material,256));
  const expected = unhex(parts[3]);
  return digest.length === expected.length && digest.reduce((difference, byte, index) => difference | (byte ^ expected[index]), 0) === 0;
}

export async function loginMember(env: Env, account: string, password: string) {
  const normalized = account.trim().toLowerCase();
  const member = await env.DB.prepare('SELECT id,password_hash,password_active,failed_attempts,locked_until FROM members WHERE deleted_at IS NULL AND (student_no=? OR username=?)').bind(normalized, normalized).all<{id:string;password_hash:string|null;password_active:number;failed_attempts:number;locked_until:string|null}>();
  if (member.results.length !== 1) throw new HTTPException(401, { message: '账号或密码不正确。' });
  const accountRow = member.results[0];
  if (accountRow.locked_until && accountRow.locked_until > now()) throw new HTTPException(429, { message: '错误次数过多，请10分钟后重试。' });
  if (!accountRow.password_active) throw new HTTPException(403, { message: '该账号尚未激活，请先用学号和邀请码激活。' });
  if (!await verifyPassword(password,accountRow.password_hash)) {
    const attempts = accountRow.failed_attempts + 1;
    await env.DB.prepare('UPDATE members SET failed_attempts=?,locked_until=? WHERE id=?').bind(attempts, attempts >= 5 ? new Date(Date.now() + 600000).toISOString() : null, accountRow.id).run();
    throw new HTTPException(401, { message: attempts >= 5 ? '错误次数过多，请10分钟后重试。' : '账号或密码不正确。' });
  }
  await env.DB.prepare('UPDATE members SET failed_attempts=0,locked_until=NULL WHERE id=?').bind(accountRow.id).run();
  return accountRow.id;
}

export async function activateMember(env: Env, studentNo: string, inviteCode: string, password: string) {
  const matches = await env.DB.prepare('SELECT m.id,m.password_active FROM members m JOIN classes c ON c.id=m.class_id WHERE m.student_no=? AND c.invite_code=? AND m.deleted_at IS NULL').bind(studentNo, inviteCode.trim().toUpperCase()).all<{id:string;password_active:number}>();
  if (matches.results.length !== 1) throw new HTTPException(403, { message: '学号或邀请码不正确。' });
  const member = matches.results[0];
  if (member.password_active) throw new HTTPException(409, { message: '该账号已激活，请用学号和密码登录。' });
  const result = await env.DB.prepare('UPDATE members SET password_hash=?,password_active=1,failed_attempts=0,locked_until=NULL WHERE id=? AND password_active=0 AND deleted_at IS NULL').bind(await hashPassword(password), member.id).run();
  if (!result.meta.changes) throw new HTTPException(409, { message: '该账号已激活，请用学号和密码登录。' });
  return member.id;
}
