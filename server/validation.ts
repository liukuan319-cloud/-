import { z } from 'zod';
export const nicknameSchema=z.string().trim().min(1).max(24);
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().startsWith(v),'日期无效');
export const noticeCategorySchema=z.enum(['important','team','exam','activity','daily']);
export const noticePrioritySchema=z.enum(['normal','high']);
export const taskDraftSchema=z.object({title:z.string().trim().min(1).max(120),description:z.string().trim().max(4000).default(''),dueAt:z.string().datetime({offset:true}).nullable(),audience:z.enum(['all','selected']),memberIds:z.array(z.string()).max(100).default([])}).refine(v=>v.audience==='all'||v.memberIds.length>0,'请选择参与成员');
export const draftSchema=z.object({title:z.string().trim().min(1).max(120),content:z.string().trim().min(1).max(12000),sourceDate:dateSchema,sourceTime:z.string().datetime({offset:true}).nullable().default(null),categoryId:noticeCategorySchema.default('daily'),priority:noticePrioritySchema.default('normal'),pinned:z.boolean().default(false),tasks:z.array(taskDraftSchema).min(1).max(12)}).refine(v=>!v.pinned||v.categoryId==='important',{message:'只有重要公告可以置顶。',path:['pinned']});
export type Draft=z.infer<typeof draftSchema>;
export function beijingDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function icsEscape(s:string){return s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');}
export function calendar(task:{id:string;title:string;description:string;dueAt:string}){
 const stamp=(d:Date)=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Class AI//Tasks//ZH','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${task.id}@class-ai`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(new Date(task.dueAt))}`,`DTEND:${stamp(new Date(Date.parse(task.dueAt)+1800000))}`,`SUMMARY:${icsEscape(task.title)}`,`DESCRIPTION:${icsEscape(task.description)}`,'BEGIN:VALARM','TRIGGER:-PT30M','ACTION:DISPLAY',`DESCRIPTION:${icsEscape(task.title)}`,'END:VALARM','END:VEVENT','END:VCALENDAR'];
 // RFC 5545: fold lines at <= 75 UTF-8 bytes without splitting a code point.
 return lines.map(line=>{let out='',part='';for(const ch of line){if(new TextEncoder().encode(part+ch).length>75){out+=part+'\r\n';part=' ';}part+=ch;}return out+part;}).join('\r\n')+'\r\n';
}
