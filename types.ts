export interface Env { DB: D1Database; ASSETS?: Fetcher; AI_API_KEY?: string; API_KEY?: string; AI_BASE_URL?: string; API_BASE?: string; AI_MODEL?: string; MODEL?: string }
export interface User { id: string; classId: string; nickname: string; role: 'admin'|'student' }
export interface Classroom { id: string; name: string; inviteCode?: string; isDemo: boolean }
export interface Identity { user: User; classroom: Classroom }
export interface Task { id: string; noticeId: string; title: string; description: string; dueAt: string|null; status: 'pending'|'completed'; version: number; noticeTitle: string; audience: 'all'|'selected' }
export interface Notice { id: string; title: string; content: string; sourceDate: string; createdAt: string; updatedAt: string; version: number; status: string; authorName: string }
export interface Action { id: string; type: string; payload: Record<string, unknown>; expiresAt: string }
export type Card = {type:'tasks';tasks:Task[]} | {type:'notice';notice:Notice} | {type:'action';action:Action} | {type:'progress';taskId:string;title:string;total:number;completed:number;members:unknown[]};
export type AppBindings = { Bindings: Env; Variables: { identity: Identity } };
