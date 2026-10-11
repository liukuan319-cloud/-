import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Identity } from './types';
import { admin, now, uuid } from './auth';

export const recordKind = z.enum(['assignment', 'fee', 'activity', 'shift']);
const recordInput = z.object({
  kind: recordKind,
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(4000).default(''),
  eventAt: z.string().datetime({ offset: true }).nullable().default(null),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  amountCents: z.number().int().min(0).max(100000000).nullable().default(null),
  feeDirection: z.enum(['income', 'expense']).nullable().default(null),
}).strict();

export async function listClassRecords(env: Env, id: Identity, kind?: string) {
  const parsed = kind ? recordKind.parse(kind) : null;
  const rows = await env.DB.prepare(`SELECT id,kind,title,detail,event_at AS eventAt,due_at AS dueAt,amount_cents AS amountCents,fee_direction AS feeDirection,created_at AS createdAt
    FROM class_records WHERE class_id=? AND (? IS NULL OR kind=?) ORDER BY COALESCE(due_at,event_at,created_at) DESC,id`).bind(id.user.classId, parsed, parsed).all();
  return rows.results;
}

export async function createClassRecord(env: Env, id: Identity, input: unknown) {
  admin(id);
  const value = recordInput.parse(input);
  if (value.kind === 'fee' && (value.amountCents === null || value.feeDirection === null)) throw new HTTPException(400, { message: '班费记录请填写收支方向和金额。' });
  const recordId = uuid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO class_records(id,class_id,kind,title,detail,event_at,due_at,amount_cents,fee_direction,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(recordId, id.user.classId, value.kind, value.title, value.detail, value.eventAt, value.dueAt, value.amountCents, value.feeDirection, id.user.id, now()),
    env.DB.prepare('INSERT INTO audit_log(id,class_id,member_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(), id.user.classId, id.user.id, 'class_record_create:' + value.kind, recordId, now()),
  ]);
  return { id: recordId, ...value };
}
