import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { admin, hash, now, secret, uuid } from './auth';
import type { Env, Identity } from './types';

const voteInput = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  anonymous: z.boolean().default(true),
  closesAt: z.iso.datetime({ offset: true }),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(12),
}).strict();

export async function createVote(env: Env, id: Identity, input: unknown) {
  admin(id);
  const data = voteInput.parse(input);
  if (Date.parse(data.closesAt) <= Date.now()) throw new HTTPException(400, { message: '截止时间必须在未来。' });
  if (new Set(data.options).size !== data.options.length) throw new HTTPException(400, { message: '投票选项不能重复。' });
  const voteId = uuid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO votes(id,class_id,author_id,title,description,anonymous,salt,closes_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(voteId,id.user.classId,id.user.id,data.title,data.description,data.anonymous?1:0,secret(),data.closesAt,now()),
    ...data.options.map((label,position) => env.DB.prepare('INSERT INTO vote_options(id,vote_id,label,position) VALUES(?,?,?,?)').bind(uuid(),voteId,label,position)),
  ]);
  return { id: voteId };
}

export async function listVotes(env: Env, id: Identity) {
  const rows = await env.DB.prepare('SELECT id,title,description,anonymous,salt,closes_at AS closesAt,ended_at AS endedAt,created_at AS createdAt FROM votes WHERE class_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(id.user.classId).all<any>();
  return Promise.all(rows.results.map(async row => {
    const fingerprint = await hash(`${row.id}:${id.user.id}:${row.salt}`);
    const [options, count, own] = await Promise.all([
      env.DB.prepare('SELECT o.id,o.label,o.position,COUNT(r.voter_hash) AS votes FROM vote_options o LEFT JOIN vote_records r ON r.option_id=o.id WHERE o.vote_id=? GROUP BY o.id ORDER BY o.position').bind(row.id).all<any>(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM vote_records WHERE vote_id=?').bind(row.id).first<{total:number}>(),
      env.DB.prepare('SELECT option_id AS optionId FROM vote_records WHERE vote_id=? AND voter_hash=?').bind(row.id,fingerprint).first<{optionId:string}>(),
    ]);
    return { id:row.id,title:row.title,description:row.description,anonymous:!!row.anonymous,closesAt:row.closesAt,endedAt:row.endedAt,createdAt:row.createdAt,
      closed:!!row.endedAt||Date.parse(row.closesAt)<=Date.now(),total:count?.total??0,ownOptionId:own?.optionId??null,options:options.results };
  }));
}

export async function castVote(env: Env, id: Identity, voteId: string, input: unknown) {
  const { optionId } = z.object({ optionId:z.string().uuid() }).strict().parse(input);
  const vote = await env.DB.prepare('SELECT id,anonymous,salt,closes_at AS closesAt,ended_at AS endedAt FROM votes WHERE id=? AND class_id=?').bind(voteId,id.user.classId).first<any>();
  if (!vote) throw new HTTPException(404, { message:'投票不存在。' });
  if (vote.endedAt || Date.parse(vote.closesAt)<=Date.now()) throw new HTTPException(409,{message:'投票已结束。'});
  const option = await env.DB.prepare('SELECT id FROM vote_options WHERE id=? AND vote_id=?').bind(optionId,voteId).first();
  if (!option) throw new HTTPException(400,{message:'选项不存在。'});
  const fingerprint = await hash(`${voteId}:${id.user.id}:${vote.salt}`);
  const result = await env.DB.prepare('INSERT INTO vote_records(vote_id,voter_hash,member_id,option_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(vote_id,voter_hash) DO NOTHING')
    .bind(voteId,fingerprint,vote.anonymous?null:id.user.id,optionId,now()).run();
  if (!result.meta.changes) throw new HTTPException(409,{message:'你已经投过票。'});
  return { ok:true };
}

export async function endVote(env: Env, id: Identity, voteId: string) {
  admin(id);
  const result = await env.DB.prepare('UPDATE votes SET ended_at=? WHERE id=? AND class_id=? AND ended_at IS NULL').bind(now(),voteId,id.user.classId).run();
  if (!result.meta.changes) throw new HTTPException(404,{message:'投票不存在或已结束。'});
  return { ok:true };
}
