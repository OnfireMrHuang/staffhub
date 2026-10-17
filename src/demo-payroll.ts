import { calculateCompensation, compensationMetricOptions, type CompensationRule } from './compensation-rules';
import type { Department, Employee } from './domain';
import type { LiveMonthly } from './live-domain';
import type { LiveRoom } from './operations-domain';

/** Explicit reporting fixture. Never changes configured rules or source monthly rows. */
export function calculateDemoPayroll(source:LiveMonthly[],employees:Employee[],departments:Department[],rooms:LiveRoom[],month:string) {
 const rows=structuredClone(source);
 const finite=(value:unknown,fallback=0):number=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:fallback;
 for(const row of rows) {
  // Defaults exist only in this simulation; ordinary payroll keeps strict validation.
  for(const {field} of compensationMetricOptions) if(row[field]!==undefined && (!Number.isFinite(row[field]) || row[field]!<0)) delete (row as unknown as Record<string,unknown>)[field];
  row.hours=finite(row.hours,160);row.nightHours=Math.min(finite(row.nightHours),row.hours);row.earlyHours=Math.min(finite(row.earlyHours),row.hours-row.nightHours);
  row.spend=finite(row.spend);row.nightSpend=Math.min(finite(row.nightSpend),row.spend);row.earlySpend=Math.min(finite(row.earlySpend),row.spend-row.nightSpend);
  row.premium=finite(row.premium);row.nightPremium=Math.min(finite(row.nightPremium),row.premium);row.earlyPremium=Math.min(finite(row.earlyPremium),row.premium-row.nightPremium);
  row.regularHours=row.hours-row.nightHours-row.earlyHours;row.regularSpend=row.spend-row.nightSpend-row.earlySpend;row.regularPremium=row.premium-row.nightPremium-row.earlyPremium;
  for(const field of ['sessions','nightSessions','earlySessions','waitingSalaryDays'] as const) row[field]=Number.isSafeInteger(row[field])&&row[field]!>=0?row[field]!:0;
 }
 const base={version:1,status:'已发布' as const,scope:'global' as const,roomIds:[] as string[]};
 const rules:CompensationRule[]=[
  {...base,id:'simulation-night',name:'模拟 · 夜班场次补贴',type:'allowance',allowance:{field:'nightSessions',amount:20}},
  {...base,id:'simulation-base',name:'模拟 · 基础时薪',type:'hourly',hourly:{duration:'hours',kind:'special',items:[{id:'base',name:'基础时薪',kind:'special',rate:50}],formula:{mode:'additions',itemIds:['base']}}},
  {...base,id:'simulation-premium',name:'模拟 · 早班保费系数',type:'premium',premium:{items:[{id:'normal',name:'正常保费',field:'regularPremium',coefficient:1},{id:'early',name:'早班保费',field:'earlyPremium',coefficient:1.2}]}},
  ...[...new Set(rows.map(row=>row.roomId))].sort().map((roomId,index):CompensationRule=>({...base,id:`simulation-room-${roomId}`,name:`模拟 · ${rooms.find(room=>room.id===roomId)?.name??roomId}时薪加成`,scope:'rooms',roomIds:[roomId],type:'hourly',hourly:{duration:'hours',kind:'special',items:[{id:'room',name:'直播间时薪加成',kind:'special',rate:10+index*5}],formula:{mode:'additions',itemIds:['room']}}})),
 ];
 return {rules,result:calculateCompensation(rows,employees,departments,rooms,rules,month)};
}
