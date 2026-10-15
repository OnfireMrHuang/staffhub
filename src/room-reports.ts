import type { Department, Employee } from './domain';
import type { AdvertisingProduct, LiveRoom } from './operations-domain';
import { buildLiveStatistics, type LiveDetail, type LiveRecord, type RoomHourly } from './live-domain';
import { applyDatasetCorrections, prepareDetailCorrection, type DetailOverride } from './dataset-corrections';
import { demoRooms } from './live-seed';

export type ReportPeriod = 'hourly' | 'daily';
export interface ReportField { key: keyof ReportRow; label: string; kind: '维度'|'指标'; type: string; editable: boolean; formula: string }
export interface ReportDefinition { id: string; name: string; version: number; sample: true; fields: ReportField[] }
export interface ReportRow extends LiveDetail { key: string; period: ReportPeriod; sourceRecordId: string; sourceRecordIds: string[]; dailyKey: string; legacyOverride: boolean; hours: number; nightHours: number; earlyHours: number }
export interface ReportOverride { period: ReportPeriod; key: string; sourceMonth: string; row: ReportRow }
export interface ReportAudit { id: string; period: ReportPeriod; key: string; sourceMonth: string; reason: string; operator: string; at: string; action: '修改'|'恢复自动'; before: ReportRow; after: ReportRow|null }
export interface RoomReportsResult { hourly: ReportRow[]; daily: ReportRow[]; contributions: LiveDetail[] }
export interface FrozenRoomReports extends RoomReportsResult { definitions: ReportDefinition[]; bindings: Record<string,string>; overrides: ReportOverride[]; audit: ReportAudit[] }
const field=(key:keyof ReportRow,label:string,kind:ReportField['kind'],type:string,editable:boolean,formula:string):ReportField=>({key,label,kind,type,editable,formula});
const common=[field('date','日期','维度','日期',false,'北京时间业务日期'),field('hostId','主播','维度','员工关联',true,'本团队主播；名称自动关联'),field('buyerId','投手','维度','员工关联',true,'本团队投手'),field('controlId','场控','维度','员工关联',true,'本团队场控'),field('hours','直播时长','指标','时长指标 / 小时',false,'实际参与小时之和；日报不把间隔计入时长'),field('spend','总消耗','指标','元',true,'同直播间实际消耗；日报求和'),field('revenue','成交金额','指标','元',true,'同直播间实际成交金额；日报求和'),field('roi','ROI','指标','比值',false,'成交金额 ÷ 消耗；消耗为0时未定义')];
export const roomReportDefinitions: ReportDefinition[]=[
 {id:'demo-performance',name:'DEMO样例 · 成交效率表',version:1,sample:true,fields:[...common,field('clicks','点击次数','指标','非负整数',true,'小时平台点击量；日报求和'),field('clickCost','点击成本','指标','元 / 次',false,'消耗 ÷ 点击次数；无分母显示未定义'),field('conversions','转化数','指标','非负整数',true,'小时平台转化量；日报求和'),field('conversionRate','转化率','指标','比例',false,'转化数 ÷ 已核验分母；单小时缺分母保留平台率，修正分子后未定义，多小时不平均') ]},
 {id:'demo-audience',name:'DEMO样例 · 直播互动表',version:1,sample:true,fields:[...common,field('orders','下单数','指标','非负整数',true,'小时下单数；日报求和'),field('viewers','观看人次','指标','非负整数',true,'小时观看人次之和，非去重人数'),field('fans','新增粉丝','指标','非负整数',true,'小时新增粉丝合计'),field('tips','打赏次数','指标','非负整数',true,'小时打赏次数合计')]},
];
// Explicit backend-owned demo bindings. Newly created rooms deliberately remain unbound.
export const roomReportBindings:Record<string,string>=Object.fromEntries(demoRooms.map((room,index)=>[room.id,index<2?'demo-performance':'demo-audience']));
export const getRoomReportDefinition=(roomId:string,definitions=roomReportDefinitions,bindings=roomReportBindings)=>definitions.find(def=>def.id===bindings[roomId]);
const totals=['spend','revenue','clicks','conversions','orders','viewers','fans','tips'] as const;
const ratio=(n:number,d:number|undefined)=>d!==undefined&&d>0?n/d:null;
function derived<T extends LiveDetail>(row:T,native?:LiveDetail):T {
 // A measured one-hour platform rate remains evidence when an optional adapter
 // denominator is absent. Once its numerator changes, that evidence no longer applies.
 const rate=(field:'clickRate'|'conversionRate',numerator:'clicks'|'conversions',denominator:'clickRateDenominator'|'conversionRateDenominator')=>row[denominator]===undefined&&native&&row[numerator]===native[numerator]?native[field]:ratio(row[numerator],row[denominator]);
 return {...row,roi:ratio(row.revenue,row.spend),clickCost:ratio(row.spend,row.clicks),conversionCost:ratio(row.spend,row.conversions),clickRate:rate('clickRate','clicks','clickRateDenominator'),conversionRate:rate('conversionRate','conversions','conversionRateDenominator')};
}
const duration=(row:Pick<LiveDetail,'start'|'end'>)=>Number(row.end.slice(0,2))-Number(row.start.slice(0,2));
const shift=(row:Pick<LiveDetail,'start'|'end'>,start:number,end:number)=>Math.max(0,Math.min(Number(row.end.slice(0,2)),end)-Math.max(Number(row.start.slice(0,2)),start));
export const reportDayKey=(row:Pick<LiveDetail,'roomId'|'date'|'hostId'|'buyerId'|'controlId'>)=>JSON.stringify([row.roomId,row.date,row.hostId,row.buyerId,row.controlId]);
const asReport=(detail:LiveDetail,period:ReportPeriod,key:string,sourceRecordIds:string[],legacyOverride=false,native?:LiveDetail):ReportRow=>({...derived(detail,period==='hourly'?detail:native),key,period,sourceRecordId:sourceRecordIds[0],sourceRecordIds,dailyKey:reportDayKey(detail),legacyOverride,hours:duration(detail),nightHours:shift(detail,2,6),earlyHours:shift(detail,6,8)});
function dailyRows(contributions:LiveDetail[],legacyIds:Set<string>):ReportRow[] {
 const groups=new Map<string,LiveDetail[]>();
 contributions.forEach(row=>{const key=reportDayKey(row);groups.set(key,[...(groups.get(key)??[]),row]);});
 return [...groups].map(([key,rows])=>{
  const summed=Object.fromEntries(totals.map(field=>[field,rows.reduce((n,row)=>n+row[field],0)]));
  const denominator=(field:'clickRateDenominator'|'conversionRateDenominator')=>rows.every(row=>row[field]!==undefined)?rows.reduce((n,row)=>n+row[field]!,0):undefined;
  const row=asReport({...rows[0],...summed,id:key,start:rows.map(r=>r.start).sort()[0],end:rows.map(r=>r.end).sort().at(-1)!,nightSpend:rows.reduce((n,r)=>n+(r.nightSpend??0),0),earlySpend:rows.reduce((n,r)=>n+(r.earlySpend??0),0),clickRateDenominator:denominator('clickRateDenominator'),conversionRateDenominator:denominator('conversionRateDenominator')},'daily',key,[...new Set(rows.map(r=>r.sourceRecordId??r.id))],rows.some(r=>legacyIds.has(r.id)),rows.length===1&&duration(rows[0])===1?rows[0]:undefined);
  return {...row,hours:rows.reduce((n,r)=>n+duration(r),0),nightHours:rows.reduce((n,r)=>n+shift(r,2,6),0),earlyHours:rows.reduce((n,r)=>n+shift(r,6,8),0)};
 });
}
/** Never allocates an old multi-hour aggregate correction to invented individual hours. */
export function buildRoomReports(records:LiveRecord[],hours:RoomHourly[],employees:Employee[],departments:Department[],rooms:LiveRoom[],products:AdvertisingProduct[],month:string,legacy:DetailOverride[]):RoomReportsResult {
 const baseline=buildLiveStatistics(records,hours,employees,departments,rooms,products,month);
 const effective=applyDatasetCorrections(baseline.details,legacy,[],employees,departments,rooms,products,month,records).details;
 const legacyIds=new Set(legacy.map(o=>o.key));
 const hourly=baseline.details.flatMap(record=>hours.filter(hour=>hour.roomId===record.roomId&&hour.date===record.date&&hour.start>=record.start&&hour.end<=record.end).map(hour=>{
  const id=JSON.stringify([record.id,hour.start]);
  return asReport({...record,...hour,id,version:record.version,nightSpend:shift(hour,2,6)?hour.spend:0,earlySpend:shift(hour,6,8)?hour.spend:0},'hourly',id,[record.id],legacyIds.has(record.id));
 }));
 const contributions:LiveDetail[]=[...hourly.filter(row=>!row.legacyOverride),...effective.filter(row=>legacyIds.has(row.id))];
 return {hourly,daily:dailyRows(contributions,legacyIds),contributions};
}
export function prepareReportCorrection(row:ReportRow,patch:Record<string,unknown>,employees:Employee[],rooms:LiveRoom[],products:AdvertisingProduct[]):ReportRow {
 const editable=['hostId','buyerId','controlId',...totals];
 if(Object.keys(patch).some(key=>!editable.includes(key))) throw new Error('报表包含只读或不支持的字段；日期、时段及直播间粒度固定');
 if(row.period==='hourly'&&row.legacyOverride) throw new Error('该时段存在历史整段修订，请先恢复历史修订；不能将整段金额猜分为小时');
 const counts=['clicks','conversions','orders','viewers','fans','tips'];
 const next={...row,...patch} as ReportRow;
 for(const field of totals) if(!Number.isFinite(next[field])||next[field]<0||(counts.includes(field)&&!Number.isInteger(next[field]))) throw new Error('基础指标必须为有限非负数，计数必须为整数');
 const {fans:_,tips:__,...supported}=patch;
 const prepared=prepareDetailCorrection(row,supported,employees,rooms,products);
 return derived({...next,...prepared,fans:next.fans,tips:next.tips},row);
}
function overlayReportRow(current:ReportRow,override:ReportOverride,employees:Employee[]):ReportRow {
 const saved=override.row;
 if(override.sourceMonth!==current.date.slice(0,7)||saved.key!==current.key||saved.period!==current.period||saved.roomId!==current.roomId||saved.date!==current.date) throw new Error('报表修订身份或原月份无效');
 const values=Object.fromEntries([...totals,'hostId','buyerId','controlId'].map(field=>[field,saved[field as keyof ReportRow]]));
 const next={...current,...values} as ReportRow;
 if(totals.some(field=>!Number.isFinite(next[field])||next[field]<0)) throw new Error('报表修订含无效基础数值');
 const staff=[next.hostId,next.buyerId,next.controlId].map(id=>employees.find(e=>e.id===id));
 if(staff.some(e=>!e)) throw new Error('报表修订员工关联无效');
 return derived({...next,hostName:staff[0]!.name,buyerName:staff[1]!.name,controlName:staff[2]!.name,dailyKey:reportDayKey(next),nightSpend:current.spend>0?next.spend*((current.nightSpend??0)/current.spend):next.spend*current.nightHours/current.hours,earlySpend:current.spend>0?next.spend*((current.earlySpend??0)/current.spend):next.spend*current.earlyHours/current.hours},current);
}
/** Daily money overrides scale actual measured contributions, preserving time and session identities.
 * This allocation affects monthly shift amounts only and is never exposed as measured hourly data. */
export function applyReportOverrides(base:RoomReportsResult,overrides:ReportOverride[],employees:Employee[],_departments:Department[],_records:LiveRecord[]):RoomReportsResult {
 if(new Set(overrides.map(o=>`${o.period}:${o.key}`)).size!==overrides.length) throw new Error('报表修订原键重复');
 const hourly=base.hourly.map(row=>{
  const override=overrides.find(o=>o.period==='hourly'&&o.key===row.key);
  if(!override) return row;
  if(row.legacyOverride) throw new Error('小时修订与历史整段修订冲突，请先恢复其中一个');
  return {...overlayReportRow(row,override,employees),legacyOverride:false};
 });
 for(const override of overrides.filter(o=>o.period==='hourly')) if(!hourly.some(row=>row.key===override.key)) throw new Error('时报修订来源已变化，请核对或恢复修订');
 let contributions:LiveDetail[]=[...hourly.filter(row=>!row.legacyOverride),...base.contributions.filter(row=>!base.hourly.some(hour=>hour.id===row.id))];
 const legacyIds=new Set(base.contributions.filter(row=>!base.hourly.some(hour=>hour.id===row.id)).map(row=>row.id));
 let daily=dailyRows(contributions,legacyIds);
 for(const override of overrides.filter(o=>o.period==='daily')) {
  const current=daily.find(row=>row.key===override.key);
  if(!current) throw new Error('日报修订团队来源已变化，请先恢复日报修订后调整时报归属');
  const next=overlayReportRow(current,override,employees);
  if(daily.some(row=>row.key!==current.key&&reportDayKey(row)===reportDayKey(next))) throw new Error('日报目标团队粒度重复');
  const members=contributions.filter(row=>reportDayKey(row)===current.key);
  // Use a remainder on the last contribution so summation preserves the exact daily total.
  const remaining=Object.fromEntries(totals.map(field=>[field,next[field]])) as Record<typeof totals[number],number>;
  contributions=contributions.map(row=>{
   if(!members.includes(row)) return row;
   const last=row===members.at(-1),values=Object.fromEntries(totals.map(field=>{
    const value=last?remaining[field]:next[field]*(current[field]>0?row[field]/current[field]:duration(row)/current.hours);
    remaining[field]-=value;return [field,value];
   }));
   const spend=values.spend as number;
   return derived({...row,...values,hostId:next.hostId,buyerId:next.buyerId,controlId:next.controlId,hostName:employees.find(e=>e.id===next.hostId)!.name,buyerName:employees.find(e=>e.id===next.buyerId)!.name,controlName:employees.find(e=>e.id===next.controlId)!.name,nightSpend:row.spend>0?spend*((row.nightSpend??0)/row.spend):spend*shift(row,2,6)/duration(row),earlySpend:row.spend>0?spend*((row.earlySpend??0)/row.spend):spend*shift(row,6,8)/duration(row)},row);
  });
  daily=daily.map(row=>row.key===current.key?{...next,nightSpend:contributions.filter(r=>members.some(m=>m.id===r.id)).reduce((n,r)=>n+(r.nightSpend??0),0),earlySpend:contributions.filter(r=>members.some(m=>m.id===r.id)).reduce((n,r)=>n+(r.earlySpend??0),0)}:row);
 }
 return {hourly,daily,contributions};
}
