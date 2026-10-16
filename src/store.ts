import { create } from 'zustand';
import { withEmployeeDefaults } from './employee-fields';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Department, Employee, Salary } from './domain';
import { seedDepartments, seedEmployees, seedRules } from './seed';
import { demoAdHours, demoMonth, demoProducts, demoRooms, demoRecords, demoRoomHours } from './live-seed';
import { buildLiveStatistics, validateLiveRecord } from './live-domain';
import { fillSimulatedHours } from './live-sync';
import type { AdHourly, LiveDetail, LiveMonthly, LiveRecord, RoomHourly } from './live-domain';
import { authenticatePassword, authenticateSso } from './auth';
import type { DemoSession } from './auth';
import { calculateDepartmentRules, migrateHourlyRules, validateDepartmentRule } from './payroll-rules';
import type { DepartmentRule } from './payroll-rules';
import { calculateCompensation, compensationRoomOwners, matchesCompensationRule, referenceDateForMonth, validateCompensationRule, validateCompensationRoomOwnership } from './compensation-rules';
import type { CalculationType, CompensationResult, CompensationRule, Scope } from './compensation-rules';
import {listRoomRuleSets,roomRuleSetId,validateRoomRuleSet,type RoomRuleSet} from './room-rule-sets';
import type { AdvertisingProduct, LiveRoom } from './operations-domain';
import { migrateOperationsState } from './operations-migration';
import { applyDatasetCorrections, monthlyRowKey, prepareDetailCorrection, prepareMonthlyCorrection } from './dataset-corrections';
import type { CorrectionAudit, DatasetTable, DetailOverride, MonthlyOverride } from './dataset-corrections';

import { buildRoomReports, applyReportOverrides, prepareReportCorrection, getRoomReportDefinition, roomReportDefinitions, roomReportBindings } from './room-reports';
import type { ReportRow, ReportPeriod, ReportOverride, ReportAudit, FrozenRoomReports } from './room-reports';
import { normalizeCurrentCompensationRule } from './compensation-rule-migration';
import { canPayroll, type PayrollPermission } from './payroll-permissions';
import { createPayrollReview, editPayrollDetail, appendPayrollColumn, applyPayrollReview } from './payroll-review';
import type { PayrollReview, PayrollCellValue, PayrollCustomColumn } from './payroll-review';

export type Page = 'operations' | 'employees' | 'departments' | 'rules' | 'payroll' | 'profile' | 'roles';
export interface Dataset { rows:LiveMonthly[]; month:string; version:number; revision:number; published:boolean }
export interface PayrollTask {
 id:string; month:string; ruleId:string; ruleName:string; ruleVersion:number; departmentId:string;
 datasetVersion:number; datasetRevision:number;
 status:'待核算'|'已核算'|'已撤回'; rule:DepartmentRule; employeeIds:string[]; created:string; withdrawnAt?:string;
}
export interface CompensationTask {
 id:string; month:string; ruleId:string; ruleName:string; ruleVersion:number; scope:Scope; type:CalculationType;
 datasetVersion:number; datasetRevision:number; referenceDate:string;
 status:'待核算'|'已核算'|'已撤回'; rule:CompensationRule; employeeIds:string[]; rowKeys:string[]; created:string; withdrawnAt?:string;
 roomRuleSet?:{id:string;version:number;ruleIds:string[];publicationId:string};
}
export interface PayrollSnapshot {
 records:LiveRecord[]; adHours:AdHourly[]; roomHours:RoomHourly[];
 employees:Employee[]; departments:Department[]; products:AdvertisingProduct[]; rooms:LiveRoom[];
 details:LiveDetail[]; monthly:LiveMonthly[]; dataset:Dataset;
 departmentRules:DepartmentRule[]; payrollTasks:PayrollTask[];
 compensationRules?:CompensationRule[]; compensationTasks?:CompensationTask[];
 roomReports?:FrozenRoomReports;
 detailOverrides?:DetailOverride[]; monthlyOverrides?:MonthlyOverride[]; correctionAudit?:CorrectionAudit[];
}
export interface Batch { month:string; status:'已核算'|'已锁定'|'已发布'; salaries:Salary[]; datasetVersion:number; ruleVersion:number; created:string; logs:string[]; snapshot:PayrollSnapshot; compensationResult?:CompensationResult; review?:PayrollReview; archivedAt?:string; archivedBy?:string }
export interface Role { id:string; name:string; description:string; permissions:string[] }
interface Hub {
 session:DemoSession|null;
 loginPassword:(username:string,password:string)=>void; loginSso:(platform:string,employeeId:string)=>void; logout:()=>void;
 page:Page; opsTab:string; month:string; employees:Employee[]; departments:Department[]; products:AdvertisingProduct[]; rooms:LiveRoom[];
 departmentRules:DepartmentRule[]; payrollTasks:PayrollTask[];
 compensationInitialized:boolean; compensationRules:CompensationRule[]; compensationTasks:CompensationTask[];
 liveRecords:LiveRecord[]; adHours:AdHourly[]; roomHours:RoomHourly[]; archivedMonths:string[]; liveDetails:LiveDetail[]; monthlyRows:LiveMonthly[];
 reportHours:ReportRow[]; reportDays:ReportRow[]; reportOverrides:ReportOverride[]; reportAudit:ReportAudit[];
 detailOverrides:DetailOverride[]; monthlyOverrides:MonthlyOverride[]; correctionAudit:CorrectionAudit[];
 dataset:Dataset; datasetsByMonth:Record<string,Dataset>; roles:Role[]; revision:number; batch:Batch|null; batches:Record<string,Batch>; syncTime:string; toast:string; perspective:'admin'|'employee';
 navigate:(page:Page,tab?:string)=>void; setMonth:(month:string)=>void; notify:(text:string)=>void; reset:()=>void;
 saveEmployee:(employee:Employee)=>void; saveDepartment:(department:Department)=>void; saveProduct:(product:AdvertisingProduct)=>void; saveRoom:(room:LiveRoom)=>void; saveLiveRecords:(records:LiveRecord[])=>void;
 cleanDataset:()=>void; saveRole:(role:Role)=>void;
 saveDatasetCorrection:(table:DatasetTable,key:string,patch:Record<string,unknown>,reason:string,expectedVersion:number)=>void;
 restoreDatasetCorrection:(table:DatasetTable,key:string,reason:string,expectedVersion:number)=>void;
 saveReportCorrection:(period:ReportPeriod,key:string,patch:Record<string,unknown>,reason:string,expectedVersion:number)=>void;
 restoreReportCorrection:(period:ReportPeriod,key:string,reason:string,expectedVersion:number)=>void;
 saveDepartmentRule:(rule:DepartmentRule)=>void; publishDepartmentRule:(id:string,month:string)=>void;
 withdrawPayrollTask:(id:string)=>void;
 saveCompensationRule:(rule:CompensationRule)=>void; deleteCompensationRule:(id:string)=>void; publishCompensationRule:(id:string,month:string)=>void; withdrawCompensationTask:(id:string)=>void;
 saveRoomRuleSet:(ruleSet:RoomRuleSet)=>void; publishRoomRuleSet:(id:string,month:string)=>void; deleteRoomRuleSet:(id:string)=>void;
 savePayrollDetail:(month:string,key:string,patch:Record<string,PayrollCellValue>,reason:string,expectedVersion:number)=>void;
 addPayrollColumn:(month:string,column:PayrollCustomColumn,expectedVersion:number)=>void;
 applyPayrollEdits:(month:string,expectedVersion:number)=>void; archivePayroll:(month:string,expectedVersion:number)=>void;
 runPayroll:(expectedVersion?:number)=>void; lockBatch:()=>void; publishBatch:()=>void; sync:()=>void; setPerspective:(value:'admin'|'employee')=>void;
}
const normalText = (value:string) => value.normalize('NFKC').trim();
const validCalendarDate = (value:string) => {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const date=Date.parse(`${value}T00:00:00Z`);
 return Number.isFinite(date) && new Date(date).toISOString().slice(0,10)===value;
};
const requireOpenMonth = (month:string, archivedMonths:string[]) => {
 if(archivedMonths.includes(month)) throw new Error(`${month} 已归档，不能修改或重新核算`);
};
// Credentials never enter the business state: only the explicit configuration flags survive.
export const safeProduct = (product:AdvertisingProduct):AdvertisingProduct => ({
 id:product.id,name:product.name,platform:product.platform,accountId:product.accountId,active:product.active,
 ...(product.access ? {access:{appId:product.access.appId,secretConfigured:!!product.access.secretConfigured,authCodeConfigured:!!product.access.authCodeConfigured}} : {}),
});
const validRoom = (roomId:string, rooms:LiveRoom[], products:AdvertisingProduct[]) => rooms.some(room=>room.id===roomId && room.active && products.some(product=>product.id===room.productId && product.active));
/** Compute a fresh candidate without writing any month. All affected months must validate
 * before a correction can replace the current visible data. */
const effectiveStatistics = (s:Hub, month:string, detailOverrides=s.detailOverrides, monthlyOverrides=s.monthlyOverrides, reportOverrides=s.reportOverrides) => {
 const baseline=buildLiveStatistics(s.liveRecords,s.roomHours,s.employees,s.departments,s.rooms,s.products,month);
 const legacy=applyDatasetCorrections(baseline.details,detailOverrides,[],s.employees,s.departments,s.rooms,s.products,month,s.liveRecords);
 const baseReports=buildRoomReports(s.liveRecords,s.roomHours,s.employees,s.departments,s.rooms,s.products,month,detailOverrides);
 const relevant=reportOverrides.filter(item=>item.sourceMonth===month);
 const reports=applyReportOverrides(baseReports,relevant,s.employees,s.departments,s.liveRecords);
 // Historical aggregate corrections retain their original identity and audit. The
 // normalized report contributions always own monthly values.
 const monthly=applyDatasetCorrections(reports.contributions,[],monthlyOverrides,s.employees,s.departments,s.rooms,s.products,month,s.liveRecords).monthly;
 return {details:legacy.details,monthly,reportHours:reports.hourly,reportDays:reports.daily,reportContributions:reports.contributions};
};
const correctedDatasetCache = (s:Hub,candidates:Map<string,ReturnType<typeof effectiveStatistics>>):Record<string,Dataset> => ({
 ...s.datasetsByMonth,
 ...Object.fromEntries([...candidates].map(([month,value])=>[month,{rows:value.monthly,month,version:(month===s.month?s.dataset.version:s.datasetsByMonth[month]?.version??s.batches[month]?.datasetVersion??s.dataset.version)+1,revision:s.revision,published:true}])),
});
const requireCorrectionDataset = (s:Hub, expectedVersion:number, reason:string) => {
 requireOpenMonth(s.month,s.archivedMonths);
 if(s.dataset.month!==s.month || s.dataset.revision!==s.revision) throw new Error('来源或员工资料已变化，请重新统计运营数据集');
 if(!s.dataset.published) throw new Error('请先刷新运营数据集');
 if(s.dataset.version!==expectedVersion) throw new Error('数据集版本已更新，请刷新后重新编辑');
 if(!reason.trim()) throw new Error('请填写修订原因');
};
const correctionMonth = (table:DatasetTable,row:LiveDetail|LiveMonthly) => table==='details'?(row as LiveDetail).date.slice(0,7):(row as LiveMonthly).month;
const reportTouchesRecord = (override:ReportOverride,id:string) => {
 if(override.row.sourceRecordId===id || override.row.sourceRecordIds.includes(id)) return true;
 // Compatibility with an early normalized report row that listed hour identities.
 return override.row.sourceRecordIds.some(key=>{try{const value:unknown=JSON.parse(key);return Array.isArray(value)&&value.length===2&&value[0]===id&&typeof value[1]==='string'&&/^\d{2}:00$/.test(value[1]);}catch{return false;}});
};
const auditTime = () => new Date().toLocaleString('sv-SE').slice(0,19);
const equalRowValue = (before:unknown,after:unknown):boolean => Array.isArray(before) && Array.isArray(after)
 ?before.length===after.length && before.every((value,index)=>value===after[index]):before===after;
const sameCorrectionRow = (before:LiveDetail|LiveMonthly,after:LiveDetail|LiveMonthly) => {
 const left=before as unknown as Record<string,unknown>,right=after as unknown as Record<string,unknown>;
 return [...new Set([...Object.keys(left),...Object.keys(right)])].every(field=>equalRowValue(left[field],right[field]));
};
const initialCompensationRules = (rooms:LiveRoom[]):CompensationRule[] => [
 {id:'demo-night-allowance',name:'示例 · 全局夜班补贴',version:1,status:'草稿',scope:'global',roomIds:[],type:'allowance',allowance:{field:'nightSessions',amount:20}},
 {id:'demo-early-premium',name:'示例 · 全局早班保费系数',version:1,status:'草稿',scope:'global',roomIds:[],type:'premium',premium:{normalField:'regularPremium',earlyField:'earlyPremium',coefficient:1.2,condition:{kind:'group',operator:'and',children:[{kind:'condition',field:'monthly.earlySessions',operator:'gte',value:1}]}}},
 {id:'demo-room-hourly',name:'示例 · 直播间 ROI 时薪',version:1,status:'草稿',scope:'rooms',roomIds:rooms.slice(0,1).map(room=>room.id),type:'hourly',hourly:{duration:'hours',items:[{id:'roi',name:'ROI 时薪',kind:'metric',field:'roi',bands:[{keyType:'range',min:0,includeMin:true,includeMax:false,rate:50}]}],formula:{mode:'additions',itemIds:['roi']}}},
];
const sameIdentities = (left:string[],right:string[]) => new Set(left).size===left.length && new Set(right).size===right.length && left.length===right.length && left.every(value=>right.includes(value));
/** The payroll task covers every eligible host, including rows without a matching rule. */
export const eligibleCompensationRows = (rows:LiveMonthly[],employees:Employee[],rooms:LiveRoom[],products:AdvertisingProduct[],month:string):LiveMonthly[] => rows.filter(row=>row.month===month && row.roles.includes('主播') && employees.some(employee=>employee.id===row.employeeId && employee.status==='在职') && validRoom(row.roomId,rooms,products));
/** The published dataset is the only writable calculation source. Check its complete
 * grain before selecting scopes so a duplicate outside one rule cannot be hidden. */
const activeCompensationRows = (s:Hub):LiveMonthly[] => {
 if(!Number.isSafeInteger(s.dataset.version) || s.dataset.version<1 || !Number.isSafeInteger(s.dataset.revision) || s.dataset.revision<0) throw new Error('运营数据集版本或来源修订无效，请重新统计');
 const keys=s.dataset.rows.map(monthlyRowKey);
 if(new Set(keys).size!==keys.length) throw new Error('运营数据集员工、直播间、月份粒度重复');
 for(const row of s.dataset.rows) {
  if(row.month!==s.month) throw new Error('运营数据集包含其他月份数据行');
  if(!s.employees.some(employee=>employee.id===row.employeeId)) throw new Error('运营数据集员工不存在，请重新统计');
  if(!s.rooms.some(room=>room.id===row.roomId && room.productId===row.productId)) throw new Error('运营数据集直播间数据行归属无效，请重新统计');
 }
 return eligibleCompensationRows(s.dataset.rows,s.employees,s.rooms,s.products,s.month);
};
const compensationParticipants = (s:Hub,rule:CompensationRule,rows:LiveMonthly[]) => {
 validateCompensationRule(rule);
 if(rule.roomIds.some(id=>!validRoom(id,s.rooms,s.products))) throw new Error('规则直播间不存在或已停用');
 const matched=rows.filter(row=>matchesCompensationRule(rule,row,s.employees,s.rooms,s.month));
 return {employeeIds:[...new Set(matched.map(row=>row.employeeId))].sort(),rowKeys:matched.map(monthlyRowKey).sort()};
};
const storedRoomRuleSet = (s:Hub,id:string):RoomRuleSet => {
 const ruleSet=listRoomRuleSets(s.compensationRules).find(item=>item.id===id);
 if(ruleSet) return ruleSet;
 if(s.compensationRules.some(rule=>rule.scope==='rooms' && roomRuleSetId(rule)===id && rule.deletedAt)) throw new Error('直播间规则集已删除');
 throw new Error('直播间规则集不存在');
};
const roomRuleSetMembers = (s:Hub,id:string) => s.compensationRules.filter(rule=>rule.scope==='rooms' && roomRuleSetId(rule)===id);
/** Include historical member IDs so legacy publications remain associated after conversion. */
const taskBelongsToRoomRuleSet = (task:CompensationTask,id:string,memberIds:Set<string>):boolean => task.roomRuleSet?.id===id || (task.rule.scope==='rooms' && (roomRuleSetId(task.rule)===id || memberIds.has(task.ruleId)));
const validateRoomRuleSetOwnership = (s:Hub,ruleSet:RoomRuleSet) => {
 const owners=compensationRoomOwners(s.compensationRules,ruleSet.id);
 for(const roomId of ruleSet.roomIds) {
  const owner=owners.get(roomId);
  if(owner) throw new Error(`直播间 ${roomId} 已被规则「${owner.name}」占用，请调整适用直播间`);
  if(!validRoom(roomId,s.rooms,s.products)) throw new Error('请选择有效且启用的直播间');
 }
};
/** Check the immutable publication, never the editable current rule set. */
const validateRoomRuleSetTasks = (tasks:CompensationTask[]) => {
 const groups=new Map<string,CompensationTask[]>();
 for(const task of tasks) {
  const membership=task.roomRuleSet;
  if(!membership) {
   if(task.rule.roomRuleSetId!==undefined) throw new Error('直播间规则集任务缺少冻结成员信息，请撤回重新发布');
   continue;
  }
  if(typeof membership.id!=='string' || !membership.id.trim() || typeof membership.publicationId!=='string' || !membership.publicationId.trim() || !Number.isSafeInteger(membership.version) || membership.version<1 || !Array.isArray(membership.ruleIds) || !membership.ruleIds.length || membership.ruleIds.length>3 || membership.ruleIds.some(id=>typeof id!=='string'||!id.trim()) || new Set(membership.ruleIds).size!==membership.ruleIds.length || task.rule.scope!=='rooms' || task.rule.roomRuleSetId!==membership.id || task.ruleVersion!==membership.version) throw new Error('直播间规则集任务的成员或版本信息无效');
  const group=groups.get(membership.id);
  if(group) group.push(task); else groups.set(membership.id,[task]);
 }
 for(const [id,group] of groups) {
  const frozen=group[0].roomRuleSet!;
  if(!sameIdentities(frozen.ruleIds,group.map(task=>task.ruleId)) || group.some(task=>task.roomRuleSet!.version!==frozen.version || task.roomRuleSet!.publicationId!==frozen.publicationId || !sameIdentities(task.roomRuleSet!.ruleIds,frozen.ruleIds))) throw new Error('直播间规则集任务成员缺失或发布版本混用，请整组撤回重新发布');
  validateRoomRuleSet({id,roomIds:group[0].rule.roomIds,rules:group.map(task=>task.rule)});
 }
};
const freezePayrollSnapshot = (s:Hub,payrollTasks:PayrollTask[],compensationTasks:CompensationTask[]):PayrollSnapshot => structuredClone({
 records:s.liveRecords.filter(r=>r.date.startsWith(s.month+'-')),adHours:s.adHours.filter(r=>r.date.startsWith(s.month+'-')),roomHours:s.roomHours.filter(r=>r.date.startsWith(s.month+'-')),
 employees:s.employees,departments:s.departments,products:s.products.map(safeProduct),rooms:s.rooms,details:s.liveDetails,monthly:s.monthlyRows,dataset:s.dataset,
 departmentRules:s.departmentRules,payrollTasks,compensationRules:s.compensationRules,compensationTasks,
 roomReports:{hourly:s.reportHours,daily:s.reportDays,contributions:effectiveStatistics(s,s.month).reportContributions,definitions:roomReportDefinitions,bindings:roomReportBindings,overrides:s.reportOverrides.filter(item=>item.sourceMonth===s.month),audit:s.reportAudit.filter(item=>item.sourceMonth===s.month)},
 detailOverrides:s.detailOverrides.filter(item=>item.sourceMonth===s.month || item.row.date.startsWith(s.month+'-')),
 monthlyOverrides:s.monthlyOverrides.filter(item=>item.sourceMonth===s.month || item.row.month===s.month),
 correctionAudit:s.correctionAudit.filter(item=>item.sourceMonth===s.month || item.targetMonth===s.month),
});
const stableValue = (value:unknown):string => JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const publicationSignature = (tasks:(PayrollTask|CompensationTask)[],month:string) => stableValue(tasks.filter(task=>task.month===month && task.status!=='已撤回').map(({status:_,withdrawnAt:__,...task})=>task).sort((a,b)=>a.id.localeCompare(b.id)));
/** Shared by the detail page and archival boundary. Browsing months never changes evidence. */
export function payrollBatchInputIssue(s:Pick<Hub,'archivedMonths'|'revision'|'month'|'dataset'|'datasetsByMonth'|'payrollTasks'|'compensationTasks'>,batch:Batch):string {
 if(s.archivedMonths.includes(batch.month)) return '';
 if(!batch.snapshot?.dataset || batch.snapshot.dataset.revision!==s.revision) return '来源或员工资料已变化，请重新核算';
 const dataset=s.dataset.month===batch.month?s.dataset:s.datasetsByMonth[batch.month];
 if(!dataset || !dataset.published || dataset.revision!==batch.snapshot.dataset.revision || dataset.version!==batch.datasetVersion || stableValue(dataset.rows)!==stableValue(batch.snapshot.dataset.rows)) return '月度汇总数据已变化，请重新核算';
 const active=[...s.payrollTasks,...s.compensationTasks],frozen=[...batch.snapshot.payrollTasks,...(batch.snapshot.compensationTasks??[])];
 if(publicationSignature(active,batch.month)!==publicationSignature(frozen,batch.month) || active.some(task=>task.month===batch.month && task.status==='待核算')) return '已发布规则任务已变化，请重新核算';
 return '';
}
const requirePayrollPermission = (s:Hub,permission:PayrollPermission) => {
 if(!canPayroll(s,permission)) throw new Error(`当前账号没有${permission}权限`);
};
const reviewBatch = (s:Hub,month:string,expectedVersion:number):Batch => {
 requireOpenMonth(month,s.archivedMonths);
 const batch=s.batches[month];
 if(!batch || !batch.snapshot || batch.status!=='已核算') throw new Error('请先核算该月工资');
 if(!Number.isSafeInteger(expectedVersion) || expectedVersion<0 || expectedVersion!==(batch.review?.version??0)) throw new Error('核算结果版本已更新，请刷新后重试');
 return batch;
};
const migratePayrollRoles = (roles:Role[]):Role[] => roles.map(role=>{
 const old=role.id==='hr'?['员工管理','部门管理','身份绑定']:role.id==='salary'?['薪酬规则','薪酬核算','工资发布','工资导出']:null;
 if(!old || !sameIdentities(role.permissions,old)) return role;
 const permissions=role.id==='hr'?['薪酬核算','薪酬结果编辑','薪酬归档']:['薪酬结果编辑'];
 return {...role,permissions:[...role.permissions,...permissions]};
});
const initial = () => {
 const employees=structuredClone(seedEmployees).map(withEmployeeDefaults),departments=structuredClone(seedDepartments),products=structuredClone(demoProducts),rooms=structuredClone(demoRooms);
 const liveRecords=structuredClone(demoRecords),adHours=structuredClone(demoAdHours),roomHours=structuredClone(demoRoomHours);
 const {details,monthly}=buildLiveStatistics(liveRecords,roomHours,employees,departments,rooms,products,demoMonth);
 const reports=buildRoomReports(liveRecords,roomHours,employees,departments,rooms,products,demoMonth,[]);
 return {
  page:'operations' as Page,opsTab:'datasets',month:demoMonth,employees,departments,products,rooms,liveRecords,adHours,roomHours,
  archivedMonths:[] as string[],liveDetails:details,monthlyRows:monthly,
  reportHours:reports.hourly,reportDays:reports.daily,reportOverrides:[] as ReportOverride[],reportAudit:[] as ReportAudit[],
  detailOverrides:[] as DetailOverride[],monthlyOverrides:[] as MonthlyOverride[],correctionAudit:[] as CorrectionAudit[],
  departmentRules:migrateHourlyRules(seedRules,rooms,products),payrollTasks:[] as PayrollTask[],
  compensationInitialized:true,compensationRules:initialCompensationRules(rooms).map(normalizeCurrentCompensationRule),compensationTasks:[] as CompensationTask[],
  dataset:{rows:monthly,month:demoMonth,version:1,revision:1,published:true},datasetsByMonth:{} as Record<string,Dataset>,
  roles:[
   {id:'employee',name:'员工',description:'查看本人资料与已发布工资',permissions:['本人资料','本人薪资条']},
   {id:'hr',name:'HR',description:'维护员工档案并复核、归档月度薪酬',permissions:['员工管理','部门管理','身份绑定','薪酬核算','薪酬结果编辑','薪酬归档']},
   {id:'ops',name:'数据运营',description:'维护投放产品、直播间与运营业务数据',permissions:['投放产品','直播间','数据录入','运营数据集']},
   {id:'salary',name:'薪酬核算',description:'配置薪酬方案并核算、复核工资',permissions:['薪酬规则','薪酬核算','薪酬结果编辑','工资发布','工资导出']},
  ],revision:1,batch:null as Batch|null,batches:{} as Record<string,Batch>,syncTime:'2026-10-13 17:00',toast:'',perspective:'admin' as const,
 };
};
export const useHub = create<Hub>()(persist((set,get)=>({
 session:null,
 loginPassword:(username,password)=>{const session=authenticatePassword(username,password,get().employees);set({session,perspective:session.kind,page:session.kind==='admin'?'operations':'profile',toast:''});},
 loginSso:(platform,employeeId)=>{const session=authenticateSso(platform,employeeId,get().employees);set({session,perspective:'employee',page:'profile',toast:''});},
 logout:()=>set({session:null,perspective:'admin',page:'operations',toast:''}),
 ...initial(),
 navigate:(page,tab)=>set({page,...(tab?{opsTab:tab}:{})}),
 setMonth:month=>{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月份格式无效');
  const s=get(),batch=s.batches[month]??null;
  if(s.month===month) {set({batch});return;}
  const datasetsByMonth={...s.datasetsByMonth,[s.dataset.month]:s.dataset};
  if(batch && s.archivedMonths.includes(month)) {
   const snapshot=structuredClone(batch.snapshot);
   set({month,batch,datasetsByMonth,dataset:snapshot.dataset,liveDetails:snapshot.details,monthlyRows:snapshot.monthly,reportHours:snapshot.roomReports?.hourly??[],reportDays:snapshot.roomReports?.daily??[]});
  } else {
   let statistics:ReturnType<typeof effectiveStatistics>={details:[],monthly:[],reportHours:[],reportDays:[],reportContributions:[]};
   try {statistics=effectiveStatistics(s,month);} catch { /* Missing sources remain stale until repaired and refreshed. */ }
   const cached=datasetsByMonth[month]??batch?.snapshot.dataset;
   // A dataset is already immutable until an explicit source/correction action. Cache
   // its version across navigation so opening a task does not invalidate publication.
   const reusable=cached?.month===month && cached.revision===s.revision;
   const published=statistics.monthly.length>0;
   const dataset=reusable?cached:{rows:statistics.monthly,month,version:Math.max(s.dataset.version,cached?.version??0)+1,revision:published?s.revision:-1,published};
   set({month,batch,datasetsByMonth,liveDetails:statistics.details,monthlyRows:reusable?cached.rows:statistics.monthly,reportHours:statistics.reportHours,reportDays:statistics.reportDays,dataset});
  }
 },
 notify:toast=>set({toast}),reset:()=>set(initial()),
 saveEmployee:employee=>{
  const s=get(),name=normalText(employee.name);
  if(!name) throw new Error('员工姓名不能为空');
  if(s.employees.some(e=>e.id!==employee.id && normalText(e.name)===name)) throw new Error('员工姓名必须全局唯一（包含已离职员工）');
  const saved=structuredClone(withEmployeeDefaults({...employee,name}));
  set({employees:s.employees.some(e=>e.id===saved.id)?s.employees.map(e=>e.id===saved.id?saved:e):[...s.employees,saved],revision:s.revision+1});
 },
 saveDepartment:department=>{
  const s=get(),saved=structuredClone(department);
  set({departments:s.departments.some(d=>d.id===saved.id)?s.departments.map(d=>d.id===saved.id?saved:d):[...s.departments,saved],revision:s.revision+1});
 },
 saveProduct:product=>{
  const s=get(),id=normalText(product.id),name=normalText(product.name),accountId=normalText(product.accountId);
  if(!id || !name) throw new Error('产品 ID 和名称不能为空');
  if(s.products.some(p=>p.id!==product.id && normalText(p.id)===id)) throw new Error('产品 ID 必须全局唯一');
  if(s.products.some(p=>p.id!==product.id && normalText(p.name)===name)) throw new Error('产品名称必须全局唯一');
  if(!['巨量引擎','磁力引擎','腾讯 ADQ'].includes(product.platform)) throw new Error('请选择有效的平台');
  if(!accountId) throw new Error('投放账户不能为空');
  const old=s.products.find(p=>p.id===product.id);
  const hasHistory=s.liveRecords.some(r=>r.productId===product.id)||s.adHours.some(r=>r.productId===product.id)||s.roomHours.some(r=>r.productId===product.id);
  if(old && hasHistory && (old.id!==id || old.platform!==product.platform || normalText(old.accountId)!==accountId)) throw new Error('已有来源历史，产品 ID、平台及账户绑定不可直接更改，请新建产品');
  // Moving a product platform must not turn its existing rooms into duplicate platform sources.
  if(s.rooms.filter(r=>r.productId===product.id).some(room=>s.rooms.some(other=>other.id!==room.id && normalText(other.platformAccountId)===normalText(room.platformAccountId) && s.products.find(p=>p.id===other.productId)?.platform===product.platform))) throw new Error('同平台直播账户只能绑定一个直播间');
  const saved=safeProduct({...product,id,name,accountId});
  set({products:old?s.products.map(p=>p.id===old.id?saved:p):[...s.products,saved],revision:s.revision+1});
 },
 saveRoom:room=>{
  const s=get(),id=normalText(room.id),name=normalText(room.name),platformAccountId=normalText(room.platformAccountId),productId=normalText(room.productId);
  if(!id || !name) throw new Error('直播间 ID 和名称不能为空');
  if(room.openedOn!==undefined && room.openedOn!=='' && !validCalendarDate(room.openedOn)) throw new Error('开播日期必须为有效 YYYY-MM-DD 日历日期');
  if(s.rooms.some(r=>r.id!==room.id && normalText(r.id)===id)) throw new Error('直播间 ID 必须全局唯一');
  if(s.rooms.some(r=>r.id!==room.id && normalText(r.name)===name)) throw new Error('直播间名称必须全局唯一');
  const product=s.products.find(p=>p.id===productId);
  if(!product) throw new Error('请选择有效的关联产品');
  if(!platformAccountId) throw new Error('直播间平台账户不能为空');
  const old=s.rooms.find(r=>r.id===room.id);
  const hasHistory=s.liveRecords.some(r=>r.roomId===room.id)||s.adHours.some(r=>r.roomId===room.id)||s.roomHours.some(r=>r.roomId===room.id);
  if(old && hasHistory && (old.id!==id || old.productId!==productId || normalText(old.platformAccountId)!==platformAccountId)) throw new Error('已有来源历史，直播间 ID、产品及账户绑定不可直接更改，请新建直播间');
  if(s.rooms.some(r=>r.id!==room.id && normalText(r.platformAccountId)===platformAccountId && s.products.find(p=>p.id===r.productId)?.platform===product.platform)) throw new Error('同平台直播账户只能绑定一个直播间');
  const saved:LiveRoom={id,name,platformAccountId,productId,active:room.active,...(room.openedOn?{openedOn:room.openedOn}:{})};
  set({rooms:old?s.rooms.map(r=>r.id===old.id?saved:r):[...s.rooms,saved],revision:s.revision+1});
 },
 saveLiveRecords:records=>{
  const s=get();
  if(!records.length) return;
  if(new Set(records.map(r=>r.id)).size!==records.length) throw new Error('本批直播记录 ID 重复');
  const incoming=structuredClone(records),ids=new Set(incoming.map(r=>r.id));
  for(const record of incoming) {
   const previous=s.liveRecords.find(r=>r.id===record.id);
   if(previous) requireOpenMonth(previous.date.slice(0,7),s.archivedMonths);
   requireOpenMonth(record.date.slice(0,7),s.archivedMonths);
   if(previous && record.version<=previous.version) throw new Error('直播记录版本已更新，请刷新后重新编辑（新版本必须递增）');
   if(previous && (['productId','roomId','date','start','end','hostId','buyerId','controlId'] as const).some(field=>previous[field]!==record[field])) {
    const overlay=s.reportOverrides.find(item=>reportTouchesRecord(item,record.id));
    if(overlay) throw new Error(`该原始记录关联已保存的${overlay.period==='hourly'?'时报':'日报'}人工修订，请先恢复关联的时报 / 日报修订，再修改来源日期、直播间、三岗或时段`);
   }
  }
  const merged=[...s.liveRecords.filter(r=>!ids.has(r.id)),...incoming];
  for(const record of incoming) {
   validateLiveRecord(record,s.employees,s.rooms,s.products,merged,s.archivedMonths);
   if(!validRoom(record.roomId,s.rooms,s.products)) throw new Error('直播记录产品或直播间已停用');
   for(const [role,id] of [['主播',record.hostId],['投手',record.buyerId],['场控',record.controlId]]) {
    const employee=s.employees.find(e=>e.id===id)!;
    if(employee.status!=='在职') throw new Error(`${role}员工 ${employee.name} 必须为在职状态`);
    if(employee.joined) {
     if(!validCalendarDate(employee.joined)) throw new Error(`${employee.name} 入职日期无效，请维护为 YYYY-MM-DD 日历日期`);
     if(record.date<employee.joined) throw new Error(`${employee.name} 的直播日期在入职日期之前`);
    }
   }
  }
  // Validate the entire candidate before the single write, so mixed uploads are atomic.
  set({liveRecords:merged,revision:s.revision+1});
 },
 cleanDataset:()=>{
  const s=get();requireOpenMonth(s.month,s.archivedMonths);
  const {details,monthly,reportHours,reportDays}=effectiveStatistics(s,s.month);
  if(!monthly.length) throw new Error('当前月份没有直播来源数据');
  set({liveDetails:details,monthlyRows:monthly,reportHours,reportDays,dataset:{rows:monthly,month:s.month,version:s.dataset.version+1,revision:s.revision,published:true}});
 },
 saveDatasetCorrection:(table,key,patch,reason,expectedVersion)=>{
  const s=get();requireCorrectionDataset(s,expectedVersion,reason);
  const before=table==='details'?s.liveDetails.find(row=>row.id===key):s.monthlyRows.find(row=>monthlyRowKey(row)===key);
  if(!before) throw new Error('当前数据行不存在，请刷新后重新编辑');
  const detailOverride=table==='details'?s.detailOverrides.find(item=>item.key===key):undefined;
  const monthlyOverride=table==='monthly'?s.monthlyOverrides.find(item=>monthlyRowKey(item.row)===key):undefined;
  const originalKey=detailOverride?.key??monthlyOverride?.key??key;
  const sourceMonth=detailOverride?.sourceMonth??monthlyOverride?.sourceMonth??correctionMonth(table,before);
  const after=table==='details'
   ?prepareDetailCorrection(before as LiveDetail,patch,s.employees,s.rooms,s.products)
   :prepareMonthlyCorrection(before as LiveMonthly,patch,s.employees,s.departments,s.rooms,s.products);
  const targetMonth=correctionMonth(table,after);
  const affectedMonths=new Set([s.month,sourceMonth,correctionMonth(table,before),targetMonth]);
  for(const month of affectedMonths) requireOpenMonth(month,s.archivedMonths);
  const detailOverrides=table==='details'?[...s.detailOverrides.filter(item=>item.key!==originalKey),{key:originalKey,sourceMonth,row:structuredClone(after as LiveDetail)}]:s.detailOverrides;
  const monthlyOverrides=table==='monthly'?[...s.monthlyOverrides.filter(item=>item.key!==originalKey),{key:originalKey,sourceMonth,row:structuredClone(after as LiveMonthly)}]:s.monthlyOverrides;
  const candidates=new Map([...affectedMonths].map(month=>[month,effectiveStatistics(s,month,detailOverrides,monthlyOverrides)]));
  const current=candidates.get(s.month)!,target=candidates.get(targetMonth)!;
  const effectiveAfter=table==='details'?target.details.find(row=>row.id===originalKey):target.monthly.find(row=>monthlyRowKey(row)===monthlyRowKey(after as LiveMonthly));
  if(!effectiveAfter) throw new Error('修订后的数据行不存在，请核对关联字段');
  // Compare values instead of serialization: omitted undefined fields and key order
  // are equivalent. A legacy rate can be re-derived by the helper even for an empty
  // patch, so unchanged submitted bases also remain a no-op.
  if(sameCorrectionRow(before,effectiveAfter) || Object.entries(patch).every(([field,value])=>equalRowValue((before as unknown as Record<string,unknown>)[field],value))) throw new Error('没有修改数据，请调整后再保存');
  const audit:CorrectionAudit={id:crypto.randomUUID(),table,key:originalKey,sourceMonth,targetMonth,reason:reason.trim(),operator:s.session?.username??'admin',at:auditTime(),action:'修改',before:structuredClone(before),after:structuredClone(effectiveAfter)};
  set({detailOverrides,monthlyOverrides,correctionAudit:[...s.correctionAudit,audit],liveDetails:current.details,monthlyRows:current.monthly,reportHours:current.reportHours,reportDays:current.reportDays,datasetsByMonth:correctedDatasetCache(s,candidates),dataset:{rows:current.monthly,month:s.month,version:s.dataset.version+1,revision:s.revision,published:true}});
 },
 restoreDatasetCorrection:(table,key,reason,expectedVersion)=>{
  const s=get();requireCorrectionDataset(s,expectedVersion,reason);
  const before=table==='details'?s.liveDetails.find(row=>row.id===key):s.monthlyRows.find(row=>monthlyRowKey(row)===key);
  if(!before) throw new Error('当前数据行不存在，请刷新后重新编辑');
  const override=table==='details'?s.detailOverrides.find(item=>item.key===key):s.monthlyOverrides.find(item=>monthlyRowKey(item.row)===key);
  if(!override) throw new Error('当前数据行没有人工修订');
  const affectedMonths=new Set([s.month,override.sourceMonth,correctionMonth(table,before),correctionMonth(table,override.row)]);
  for(const month of affectedMonths) requireOpenMonth(month,s.archivedMonths);
  const detailOverrides=table==='details'?s.detailOverrides.filter(item=>item.key!==override.key):s.detailOverrides;
  const monthlyOverrides=table==='monthly'?s.monthlyOverrides.filter(item=>item.key!==override.key):s.monthlyOverrides;
  const candidates=new Map([...affectedMonths].map(month=>[month,effectiveStatistics(s,month,detailOverrides,monthlyOverrides)]));
  const current=candidates.get(s.month)!;
  const after=table==='details'?current.details.find(row=>row.id===override.key):current.monthly.find(row=>monthlyRowKey(row)===override.key);
  const audit:CorrectionAudit={id:crypto.randomUUID(),table,key:override.key,sourceMonth:override.sourceMonth,targetMonth:correctionMonth(table,before),reason:reason.trim(),operator:s.session?.username??'admin',at:auditTime(),action:'恢复自动',before:structuredClone(before),after:after?structuredClone(after):null};
  set({detailOverrides,monthlyOverrides,correctionAudit:[...s.correctionAudit,audit],liveDetails:current.details,monthlyRows:current.monthly,reportHours:current.reportHours,reportDays:current.reportDays,datasetsByMonth:correctedDatasetCache(s,candidates),dataset:{rows:current.monthly,month:s.month,version:s.dataset.version+1,revision:s.revision,published:true}});
 },
 saveReportCorrection:(period,key,patch,reason,expectedVersion)=>{
  const s=get();requireCorrectionDataset(s,expectedVersion,reason);
  const before=(period==='hourly'?s.reportHours:s.reportDays).find(row=>row.key===key);
  if(!before) throw new Error('当前报表行不存在，请刷新后重新编辑');
  const definition=getRoomReportDefinition(before.roomId);
  if(!definition) throw new Error('该直播间未绑定后台报表定义，不能修订');
  const allowed=new Set(definition.fields.filter(field=>field.editable).map(field=>field.key));
  if(Object.keys(patch).some(field=>!allowed.has(field as keyof ReportRow))) throw new Error('提交包含本报表只读或不支持的字段');
  const after=prepareReportCorrection(before,patch,s.employees,s.rooms,s.products);
  if(Object.entries(patch).every(([field,value])=>equalRowValue((before as unknown as Record<string,unknown>)[field],value))) throw new Error('没有修改数据，请调整后再保存');
  const old=s.reportOverrides.find(item=>item.period===period&&item.key===key),sourceMonth=old?.sourceMonth??before.date.slice(0,7);
  requireOpenMonth(sourceMonth,s.archivedMonths);requireOpenMonth(after.date.slice(0,7),s.archivedMonths);
  const reportOverrides=[...s.reportOverrides.filter(item=>item.period!==period||item.key!==key),{period,key,sourceMonth,row:structuredClone(after)}];
  const candidate=effectiveStatistics(s,s.month,s.detailOverrides,s.monthlyOverrides,reportOverrides);
  const effective=(period==='hourly'?candidate.reportHours:candidate.reportDays).find(row=>row.key===key)!;
  const audit:ReportAudit={id:crypto.randomUUID(),period,key,sourceMonth,reason:reason.trim(),operator:s.session?.username??'admin',at:auditTime(),action:'修改',before:structuredClone(before),after:structuredClone(effective)};
  set({reportOverrides,reportAudit:[...s.reportAudit,audit],reportHours:candidate.reportHours,reportDays:candidate.reportDays,liveDetails:candidate.details,monthlyRows:candidate.monthly,dataset:{rows:candidate.monthly,month:s.month,version:s.dataset.version+1,revision:s.revision,published:true}});
 },
 restoreReportCorrection:(period,key,reason,expectedVersion)=>{
  const s=get();requireCorrectionDataset(s,expectedVersion,reason);
  const override=s.reportOverrides.find(item=>item.period===period&&item.key===key);
  const before=(period==='hourly'?s.reportHours:s.reportDays).find(row=>row.key===key);
  if(!override||!before) throw new Error('当前行没有可恢复的人工修订');
  requireOpenMonth(override.sourceMonth,s.archivedMonths);
  const reportOverrides=s.reportOverrides.filter(item=>item!==override);
  const candidate=effectiveStatistics(s,s.month,s.detailOverrides,s.monthlyOverrides,reportOverrides);
  const after=(period==='hourly'?candidate.reportHours:candidate.reportDays).find(row=>row.key===key)??null;
  const audit:ReportAudit={id:crypto.randomUUID(),period,key,sourceMonth:override.sourceMonth,reason:reason.trim(),operator:s.session?.username??'admin',at:auditTime(),action:'恢复自动',before:structuredClone(before),after:after?structuredClone(after):null};
  set({reportOverrides,reportAudit:[...s.reportAudit,audit],reportHours:candidate.reportHours,reportDays:candidate.reportDays,liveDetails:candidate.details,monthlyRows:candidate.monthly,dataset:{rows:candidate.monthly,month:s.month,version:s.dataset.version+1,revision:s.revision,published:true}});
 },
 saveRole:role=>{const s=get(),saved=structuredClone(role);set({roles:s.roles.some(r=>r.id===role.id)?s.roles.map(r=>r.id===role.id?saved:r):[...s.roles,saved]});},
 saveDepartmentRule:rule=>{
  const s=get(),previous=s.departmentRules.find(r=>r.id===rule.id);
  if(rule.sourceFloor && !previous?.sourceFloor) throw new Error('来源优先条件仅用于迁移历史资料，不能手动新增');
  const saved=structuredClone({...rule,name:normalText(rule.name),version:previous?previous.version+1:1,status:'草稿' as const,sourceFloor:previous?.sourceFloor,sourceNote:previous?.sourceNote});
  validateDepartmentRule(saved);
  if(!s.departments.some(d=>d.id===saved.departmentId && d.active)) throw new Error('请选择有效部门');
  if(saved.departmentId!=='live') throw new Error('该部门月薪规则待开发');
  if(saved.roomIds.some(id=>!validRoom(id,s.rooms,s.products))) throw new Error('请选择有效且启用的直播间');
  set({departmentRules:previous?s.departmentRules.map(r=>r.id===saved.id?saved:r):[...s.departmentRules,saved]});
 },
 publishDepartmentRule:(id,month)=>{
  const s=get();requireOpenMonth(month,s.archivedMonths);
  if(month!==s.month || s.dataset.month!==month) throw new Error('发布月份必须与当前运营数据集月份一致');
  if(s.dataset.revision!==s.revision) throw new Error('来源或员工资料已变化，请重新统计运营数据集');
  if(!s.dataset.published) throw new Error('请先刷新运营数据集');
  const rule=s.departmentRules.find(r=>r.id===id);
  if(!rule) throw new Error('部门规则不存在');
  if(s.payrollTasks.some(t=>t.ruleId===id && t.month===month && t.status!=='已撤回')) throw new Error('同一规则同月不能重复发布');
  validateDepartmentRule(rule);
  if(rule.departmentId!=='live' || !s.departments.some(d=>d.id===rule.departmentId && d.active)) throw new Error('规则部门无效或月薪规则待开发');
  if(rule.roomIds.some(roomId=>!validRoom(roomId,s.rooms,s.products))) throw new Error('规则直播间不存在或已停用');
  const employeeIds=s.employees.filter(e=>e.status==='在职' && s.dataset.rows.some(r=>r.employeeId===e.id && r.departmentId===rule.departmentId && r.month===month && rule.roomIds.includes(r.roomId))).map(e=>e.id);
  if(!employeeIds.length) throw new Error('部门与直播间集没有参与工作员工，不能发布核算任务');
  const published=structuredClone({...rule,status:'已发布' as const});
  const task:PayrollTask={id:crypto.randomUUID(),month,ruleId:id,ruleName:rule.name,ruleVersion:rule.version,departmentId:rule.departmentId,datasetVersion:s.dataset.version,datasetRevision:s.dataset.revision,status:'待核算',rule:structuredClone(published),employeeIds,created:new Date().toLocaleString('sv-SE').slice(0,19)};
  set({departmentRules:s.departmentRules.map(r=>r.id===id?published:r),payrollTasks:[...s.payrollTasks,task]});
 },
 withdrawPayrollTask:id=>{
  const s=get(),task=s.payrollTasks.find(t=>t.id===id);
  if(!task) throw new Error('核算任务不存在');
  requireOpenMonth(task.month,s.archivedMonths);
  if(task.status==='已撤回') throw new Error('仅待核算或未归档的已核算任务可撤回');
  const payrollTasks=s.payrollTasks.map(t=>t.id===id?{...t,status:'已撤回' as const,withdrawnAt:new Date().toLocaleString('sv-SE').slice(0,19)}:t);
  const hasOtherTask=payrollTasks.some(t=>t.ruleId===task.ruleId && t.ruleVersion===task.ruleVersion && t.status!=='已撤回');
  const departmentRules=s.departmentRules.map(r=>r.id===task.ruleId && r.version===task.ruleVersion && !hasOtherTask?{...r,status:'草稿' as const}:r);
  set({payrollTasks,departmentRules});
 },
 saveCompensationRule:rule=>{
  const s=get(),previousSource=s.compensationRules.find(item=>item.id===rule.id),previous=previousSource?normalizeCurrentCompensationRule(previousSource):undefined;
  rule=normalizeCurrentCompensationRule(rule);
  if(previous?.deletedAt || rule.deletedAt) throw new Error('薪酬规则已删除，不能保存');
  if(rule.roomRuleSetId!==undefined || previous?.roomRuleSetId!==undefined || s.compensationRules.some(item=>item.roomRuleSetId===rule.id)) throw new Error('直播间规则集须通过整组编辑保存');
  if(previous && previous.scope!==rule.scope) throw new Error('规则分类确定后不可修改，请在对应分类中新增规则');
  const saved:CompensationRule=structuredClone({...rule,name:normalText(rule.name),version:previousSource?previousSource.version+1:1,status:'草稿'});
  validateCompensationRule(saved);
  validateCompensationRoomOwnership(saved,s.compensationRules);
  if(saved.roomIds.some(id=>!validRoom(id,s.rooms,s.products))) throw new Error('请选择有效且启用的直播间');
  set({compensationRules:previous?s.compensationRules.map(item=>item.id===saved.id?saved:item):[...s.compensationRules,saved]});
 },
 deleteCompensationRule:id=>{
  const s=get(),rule=s.compensationRules.find(item=>item.id===id);
  if(!rule) throw new Error('薪酬规则不存在');
  if(rule.deletedAt) throw new Error('薪酬规则已删除');
  if(rule.roomRuleSetId!==undefined) throw new Error('直播间规则集须整组删除');
  const pending=s.compensationTasks.filter(task=>task.ruleId===id && task.status==='待核算');
  for(const task of pending) requireOpenMonth(task.month,s.archivedMonths);
  const deletedAt=auditTime();
  set({
   compensationRules:s.compensationRules.map(item=>item.id===id?{...item,deletedAt}:item),
   compensationTasks:s.compensationTasks.map(task=>task.ruleId===id && task.status==='待核算'?{...task,status:'已撤回' as const,withdrawnAt:deletedAt}:task),
  });
 },
 publishCompensationRule:(id,month)=>{
  const s=get();requireOpenMonth(month,s.archivedMonths);
  const referenceDate=referenceDateForMonth(month);
  if(month!==s.month || s.dataset.month!==month) throw new Error('发布月份必须与当前运营数据集月份一致');
  if(s.dataset.revision!==s.revision) throw new Error('来源或员工资料已变化，请重新统计运营数据集');
  if(!s.dataset.published) throw new Error('请先刷新运营数据集');
  const rule=s.compensationRules.find(item=>item.id===id);
  if(!rule) throw new Error('薪酬规则不存在');
  if(rule.deletedAt) throw new Error('薪酬规则已删除，不能发布');
  if(rule.roomRuleSetId!==undefined) throw new Error('直播间规则集须整组发布');
  validateCompensationRoomOwnership(rule,s.compensationRules);
  if(rule.scope==='rooms' && s.compensationTasks.some(task=>task.month===month && task.status!=='已撤回' && task.ruleId!==id && task.rule.scope==='rooms' && task.rule.roomIds.some(roomId=>rule.roomIds.includes(roomId)))) throw new Error('直播间仍有其他规则的待核算或已核算任务，请先撤回该任务再发布');
  if(s.compensationTasks.some(task=>task.ruleId===id && task.month===month && task.status!=='已撤回')) throw new Error('同一规则同月不能重复发布');
  const participants=compensationParticipants(s,rule,activeCompensationRows(s));
  if(!participants.employeeIds.length) throw new Error('规则范围内没有参与工作员工，不能发布核算任务');
  const published:CompensationRule=structuredClone({...rule,status:'已发布'});
  const task:CompensationTask={id:crypto.randomUUID(),month,ruleId:id,ruleName:published.name,ruleVersion:published.version,scope:published.scope,type:published.type,datasetVersion:s.dataset.version,datasetRevision:s.dataset.revision,referenceDate,status:'待核算',rule:structuredClone(published),...participants,created:auditTime()};
  set({compensationRules:s.compensationRules.map(item=>item.id===id?published:item),compensationTasks:[...s.compensationTasks,task]});
 },
 saveRoomRuleSet:ruleSet=>{
  const s=get();
  // Unsaved editor children start at version zero; stored versions and status are owned here.
  validateRoomRuleSet({...ruleSet,rules:ruleSet.rules.map(rule=>({...rule,version:1,status:'草稿'}))});
  const previous=roomRuleSetMembers(s,ruleSet.id),active=previous.filter(rule=>!rule.deletedAt);
  if(previous.length && !active.length) throw new Error('直播间规则集已删除，不能保存');
  if(s.compensationRules.some(rule=>rule.id===ruleSet.id && (rule.scope!=='rooms' || roomRuleSetId(rule)!==ruleSet.id))) throw new Error('规则集 ID 已被其他规则归属占用');
  for(const rule of ruleSet.rules) {
   const existing=s.compensationRules.find(item=>item.id===rule.id);
   if(existing?.deletedAt) throw new Error('子规则已删除，不能重新保存');
   if(existing && (existing.scope!=='rooms' || roomRuleSetId(existing)!==ruleSet.id)) throw new Error('子规则分类或规则集归属不可修改');
   if(s.compensationRules.some(item=>item.roomRuleSetId===rule.id && item.roomRuleSetId!==ruleSet.id)) throw new Error('子规则 ID 已被其他规则集占用');
  }
  validateRoomRuleSetOwnership(s,ruleSet);
  const version=Math.max(0,...previous.map(rule=>rule.version))+1;
  const members=ruleSet.rules.map(rule=>structuredClone({...rule,name:normalText(rule.name),version,status:'草稿' as const,roomRuleSetId:ruleSet.id,roomIds:[...ruleSet.roomIds]}));
  validateRoomRuleSet({...ruleSet,rules:members});
  const memberIds=new Set(members.map(rule=>rule.id)),previousIds=new Set(previous.map(rule=>rule.id));
  const removed=active.some(rule=>!memberIds.has(rule.id));
  const pending=removed?s.compensationTasks.filter(task=>task.status==='待核算' && taskBelongsToRoomRuleSet(task,ruleSet.id,previousIds)):[];
  for(const task of pending) requireOpenMonth(task.month,s.archivedMonths);
  const at=auditTime(),pendingIds=new Set(pending.map(task=>task.id));
  const updates=new Map(members.map(rule=>[rule.id,rule]));
  const compensationRules=s.compensationRules.map(rule=>updates.get(rule.id)??(previousIds.has(rule.id) && !rule.deletedAt?{...rule,deletedAt:at}:rule));
  compensationRules.push(...members.filter(rule=>!s.compensationRules.some(item=>item.id===rule.id)));
  set({compensationRules,compensationTasks:s.compensationTasks.map(task=>pendingIds.has(task.id)?{...task,status:'已撤回' as const,withdrawnAt:at}:task)});
 },
 publishRoomRuleSet:(id,month)=>{
  const s=get();requireOpenMonth(month,s.archivedMonths);
  const referenceDate=referenceDateForMonth(month);
  if(month!==s.month || s.dataset.month!==month) throw new Error('发布月份必须与当前运营数据集月份一致');
  if(s.dataset.revision!==s.revision) throw new Error('来源或员工资料已变化，请重新统计运营数据集');
  if(!s.dataset.published) throw new Error('请先刷新运营数据集');
  const ruleSet=storedRoomRuleSet(s,id);validateRoomRuleSet(ruleSet);validateRoomRuleSetOwnership(s,ruleSet);
  if(new Set(ruleSet.rules.map(rule=>rule.version)).size!==1) throw new Error('直播间规则集子规则版本不一致，请整组保存');
  const memberIds=new Set(roomRuleSetMembers(s,id).map(rule=>rule.id));
  if(s.compensationTasks.some(task=>task.month===month && task.status!=='已撤回' && taskBelongsToRoomRuleSet(task,id,memberIds))) throw new Error('同一直播间规则集同月不能重复发布');
  if(s.compensationTasks.some(task=>task.month===month && task.status!=='已撤回' && task.rule.scope==='rooms' && task.rule.roomIds.some(roomId=>ruleSet.roomIds.includes(roomId)))) throw new Error('直播间仍有其他规则集的待核算或已核算任务，请先整组撤回该任务再发布');
  const rows=activeCompensationRows(s),created=auditTime();
  const roomRuleSet={id,version:ruleSet.rules[0].version,ruleIds:ruleSet.rules.map(rule=>rule.id),publicationId:crypto.randomUUID()};
  const published=ruleSet.rules.map(rule=>structuredClone({...rule,roomRuleSetId:id,status:'已发布' as const}));
  const tasks:CompensationTask[]=published.map(rule=>{
   const participants=compensationParticipants(s,rule,rows);
   if(!participants.employeeIds.length) throw new Error('规则集范围内没有参与工作员工，不能发布核算任务');
   return {id:crypto.randomUUID(),month,ruleId:rule.id,ruleName:rule.name,ruleVersion:rule.version,scope:rule.scope,type:rule.type,datasetVersion:s.dataset.version,datasetRevision:s.dataset.revision,referenceDate,status:'待核算',rule:structuredClone(rule),...participants,created,roomRuleSet:structuredClone(roomRuleSet)};
  });
  validateRoomRuleSetTasks(tasks);
  const updates=new Map(published.map(rule=>[rule.id,rule]));
  set({compensationRules:s.compensationRules.map(rule=>updates.get(rule.id)??rule),compensationTasks:[...s.compensationTasks,...tasks]});
 },
 deleteRoomRuleSet:id=>{
  const s=get();storedRoomRuleSet(s,id);
  const memberIds=new Set(roomRuleSetMembers(s,id).map(rule=>rule.id));
  const pending=s.compensationTasks.filter(task=>task.status==='待核算' && taskBelongsToRoomRuleSet(task,id,memberIds));
  for(const task of pending) requireOpenMonth(task.month,s.archivedMonths);
  const deletedAt=auditTime(),pendingIds=new Set(pending.map(task=>task.id));
  set({
   compensationRules:s.compensationRules.map(rule=>memberIds.has(rule.id) && !rule.deletedAt?{...rule,deletedAt}:rule),
   compensationTasks:s.compensationTasks.map(task=>pendingIds.has(task.id)?{...task,status:'已撤回' as const,withdrawnAt:deletedAt}:task),
  });
 },
 withdrawCompensationTask:id=>{
  const s=get(),task=s.compensationTasks.find(item=>item.id===id);
  if(!task) throw new Error('核算任务不存在');
  requireOpenMonth(task.month,s.archivedMonths);
  if(task.status==='已撤回') throw new Error('仅待核算或未归档的已核算任务可撤回');
  const setId=task.roomRuleSet?.id??task.rule.roomRuleSetId;
  const pending=setId?s.compensationTasks.filter(item=>item.month===task.month && item.status!=='已撤回' && (item.roomRuleSet?.id===setId || item.rule.roomRuleSetId===setId)):[task];
  for(const item of pending) requireOpenMonth(item.month,s.archivedMonths);
  const pendingIds=new Set(pending.map(item=>item.id)),withdrawnAt=auditTime();
  const compensationTasks=s.compensationTasks.map(item=>pendingIds.has(item.id)?{...item,status:'已撤回' as const,withdrawnAt}:item);
  const compensationRules=s.compensationRules.map(rule=>pending.some(item=>item.ruleId===rule.id && item.ruleVersion===rule.version) && !compensationTasks.some(item=>item.ruleId===rule.id && item.ruleVersion===rule.version && item.status!=='已撤回')?{...rule,status:'草稿' as const}:rule);
  set({compensationTasks,compensationRules});
 },
 runPayroll:expectedVersion=>{
  const s=get();requireOpenMonth(s.month,s.archivedMonths);
  requirePayrollPermission(s,'薪酬核算');
  const previous=s.batches[s.month],previousVersion=previous?.review?.version??0;
  if(!Number.isSafeInteger(previousVersion) || previousVersion<0 || (previous && expectedVersion!==previousVersion) || (!previous && expectedVersion!==undefined)) throw new Error('核算结果版本已更新，请刷新后重新确认核算');
  const review={...createPayrollReview(),version:previous?previousVersion+1:0};
  if(!Number.isSafeInteger(review.version)) throw new Error('核算结果版本无效，请联系管理员');
  if(s.dataset.revision!==s.revision || s.dataset.month!==s.month) throw new Error('来源或员工资料已变化，请重新统计运营数据集');
  if(!s.dataset.published) throw new Error('请先刷新运营数据集');
  const tasks=s.payrollTasks.filter(t=>t.month===s.month && t.status!=='已撤回');
  const newTasks=s.compensationTasks.filter(task=>task.month===s.month && task.status!=='已撤回');
  if(newTasks.length && tasks.length) throw new Error('当前月份同时存在新版与旧部门规则任务，请先撤回旧任务，再核算新版薪酬');
  if(newTasks.length) {
   const rows=activeCompensationRows(s),referenceDate=referenceDateForMonth(s.month);
   if(new Set(newTasks.map(task=>task.ruleId)).size!==newTasks.length) throw new Error('同月薪酬规则任务重复或版本冲突');
   validateRoomRuleSetTasks(newTasks);
   for(const task of newTasks) {
    if(task.rule.id!==task.ruleId || task.rule.version!==task.ruleVersion || task.rule.status!=='已发布' || task.scope!==task.rule.scope || task.type!==task.rule.type || task.referenceDate!==referenceDate) throw new Error('核算任务规则版本或参考日期发生变化，请撤回重新发布');
    if(task.datasetVersion!==s.dataset.version || task.datasetRevision!==s.dataset.revision) throw new Error('发布数据集版本或来源修订发生变化，请撤回任务并重新发布');
    const participants=compensationParticipants(s,task.rule,rows);
    if(!sameIdentities(task.employeeIds,participants.employeeIds)) throw new Error('已确认任务员工名单发生变化，请核对来源与发布任务');
    if(!sameIdentities(task.rowKeys,participants.rowKeys)) throw new Error('已确认任务员工直播间月份数据行粒度发生变化，请撤回并重新发布');
   }
   // Import every eligible host row. Each scope aggregates monetary amounts;
   // coefficient-adjusted ROI and rank are resolved before hourly evaluation.
   const compensationResult=calculateCompensation(rows,s.employees,s.departments,s.rooms,newTasks.map(task=>task.rule),s.month);
   const expectedEmployees=[...new Set(rows.map(row=>row.employeeId))],expectedRows=rows.map(monthlyRowKey);
   if(!sameIdentities(expectedEmployees,compensationResult.salaries.map(salary=>salary.employeeId)) || !sameIdentities(expectedRows,compensationResult.rows.map(monthlyRowKey))) throw new Error('薪酬核算未覆盖全部已确认员工与数据行');
   if(compensationResult.salaries.some(salary=>[salary.fixed,salary.commission,salary.total].some(value=>!Number.isFinite(value) || value<0))) throw new Error('薪酬核算金额无效');
   const compensationTasks=s.compensationTasks.map(task=>task.month===s.month && task.status!=='已撤回'?{...task,status:'已核算' as const}:task);
   const snapshot=freezePayrollSnapshot(s,s.payrollTasks,compensationTasks);
   const batch:Batch={month:s.month,status:'已核算',salaries:structuredClone(compensationResult.salaries),compensationResult:structuredClone(compensationResult),review,datasetVersion:s.dataset.version,ruleVersion:Math.max(...newTasks.map(task=>task.ruleVersion)),created:auditTime(),snapshot,logs:[
    `读取固定运营数据集 v${s.dataset.version}，来源修订 ${s.dataset.revision}`,
    `${newTasks.length} 个新版薪酬规则任务，导入 ${expectedEmployees.length} 位主播、${expectedRows.length} 条月度数据行（含未命中规则行）`,
    `参考日期 ${referenceDate}：按已发布规则范围核算；系数保费取大后更新 ROI 与排名，再计算时薪金额`,
    '总计月薪 = max（各范围保底金额最大值，各范围加成金额合计）+ 各范围补贴合计',
    ...newTasks.map(task=>`${task.ruleName} v${task.ruleVersion}：数据集 v${task.datasetVersion}（来源修订 ${task.datasetRevision}）`),
    `${s.month} 核算成功：保留员工、规则、任务、来源与计算明细，等待 HR 复核归档`,
   ]};
   set({batch,batches:{...s.batches,[s.month]:batch},compensationTasks,datasetsByMonth:{...s.datasetsByMonth,[s.month]:s.dataset}});
   return;
  }
  if(!tasks.length) throw new Error('当前月份没有已发布的核算任务');
  const merged=new Map<string,Salary>();
  for(const task of tasks) {
   if(!s.departments.some(d=>d.id===task.departmentId && d.active)) throw new Error('核算任务部门已停用，请核对');
   if(task.rule.roomIds.some(id=>!validRoom(id,s.rooms,s.products))) throw new Error('核算任务直播间已停用，请核对');
   const currentEmployeeIds=new Set(s.employees.filter(e=>e.status==='在职' && s.dataset.rows.some(r=>r.employeeId===e.id && r.departmentId===task.departmentId && r.month===s.month && task.rule.roomIds.includes(r.roomId))).map(e=>e.id));
   if(currentEmployeeIds.size!==task.employeeIds.length || task.employeeIds.some(id=>!currentEmployeeIds.has(id))) throw new Error('已确认任务员工名单发生变化，请核对来源与发布任务');
   const employees=task.employeeIds.map(id=>{
    const employee=s.employees.find(e=>e.id===id);
    if(!employee || employee.status!=='在职' || !s.dataset.rows.some(r=>r.employeeId===id && r.departmentId===task.departmentId && r.month===s.month && task.rule.roomIds.includes(r.roomId))) throw new Error('已确认任务员工的部门、在职状态或工作数据已变化，请核对');
    return employee;
   });
   if(!employees.length) throw new Error('核算任务缺少已确认员工');
   const calculated=calculateDepartmentRules(s.dataset.rows,employees,s.departments,[task.rule],s.month);
   if(calculated.length!==employees.length || employees.some(e=>!calculated.some(salary=>salary.employeeId===e.id))) throw new Error('核算任务未覆盖全部已确认员工');
   for(const salary of calculated) {
    const existing=merged.get(salary.employeeId);
    const combined=existing?{...existing,departmentName:[...new Set([...existing.departmentName.split('、'),salary.departmentName])].join('、'),commission:Math.round((existing.commission+salary.commission)*100)/100,total:Math.round((existing.total+salary.total)*100)/100,details:[...existing.details,...salary.details]}:salary;
    if([combined.fixed,combined.commission,combined.total].some(value=>!Number.isFinite(value) || value<0)) throw new Error(`${salary.employeeName} 薪资任务汇总无效，请核对金额`);
    merged.set(salary.employeeId,combined);
   }
  }
  const salaries=[...merged.values()];
  const payrollTasks=s.payrollTasks.map(t=>t.month===s.month && t.status!=='已撤回'?{...t,status:'已核算' as const}:t);
  const snapshot:PayrollSnapshot=structuredClone({
   records:s.liveRecords.filter(r=>r.date.startsWith(s.month+'-')),adHours:s.adHours.filter(r=>r.date.startsWith(s.month+'-')),roomHours:s.roomHours.filter(r=>r.date.startsWith(s.month+'-')),
   employees:s.employees,departments:s.departments,products:s.products.map(safeProduct),rooms:s.rooms,details:s.liveDetails,monthly:s.monthlyRows,dataset:s.dataset,roomReports:{hourly:s.reportHours,daily:s.reportDays,contributions:effectiveStatistics(s,s.month).reportContributions,definitions:roomReportDefinitions,bindings:roomReportBindings,overrides:s.reportOverrides.filter(item=>item.sourceMonth===s.month),audit:s.reportAudit.filter(item=>item.sourceMonth===s.month)},departmentRules:s.departmentRules,payrollTasks,compensationRules:s.compensationRules,compensationTasks:s.compensationTasks,
   detailOverrides:s.detailOverrides.filter(item=>item.sourceMonth===s.month || item.row.date.startsWith(s.month+'-')),
   monthlyOverrides:s.monthlyOverrides.filter(item=>item.sourceMonth===s.month || item.row.month===s.month),
   correctionAudit:s.correctionAudit.filter(item=>item.sourceMonth===s.month || item.targetMonth===s.month),
  });
  const batch:Batch={month:s.month,status:'已核算',salaries:structuredClone(salaries),review,datasetVersion:s.dataset.version,ruleVersion:Math.max(...tasks.map(t=>t.ruleVersion)),created:new Date().toLocaleString('sv-SE').slice(0,19),snapshot,logs:[
   `模拟来源版本 ${s.revision} 已确认：直播记录与直播间小时数据`,
   `读取固定运营数据集 v${s.dataset.version}，${s.dataset.rows.length} 条员工直播间月度记录`,
   `${tasks.length} 个已发布部门规则任务，${salaries.length} 位已确认员工`,
   ...tasks.map(t=>`${t.ruleName} v${t.ruleVersion}：发布数据集 v${t.datasetVersion}（来源修订 ${t.datasetRevision}）→ 核算数据集 v${s.dataset.version}（来源修订 ${s.dataset.revision}）`),
   '直播间集汇总 → 指标与绑定时长 → 各项薪资相加',
   `${s.month} 核算成功：保留员工、规则、来源与统计依据，等待 HR 复核归档`,
  ]};
  set({batch,batches:{...s.batches,[s.month]:batch},payrollTasks,datasetsByMonth:{...s.datasetsByMonth,[s.month]:s.dataset}});
 },
 savePayrollDetail:(month,key,patch,reason,expectedVersion)=>{
  const s=get();requirePayrollPermission(s,'薪酬结果编辑');
  const batch=editPayrollDetail(reviewBatch(s,month,expectedVersion),key,patch,reason,s.session!.username);
  set({batches:{...s.batches,[month]:batch},...(s.month===month?{batch}:{})});
 },
 addPayrollColumn:(month,column,expectedVersion)=>{
  const s=get();requirePayrollPermission(s,'薪酬结果编辑');
  const batch=appendPayrollColumn(reviewBatch(s,month,expectedVersion),column,s.session!.username);
  set({batches:{...s.batches,[month]:batch},...(s.month===month?{batch}:{})});
 },
 applyPayrollEdits:(month,expectedVersion)=>{
  const s=get();requirePayrollPermission(s,'薪酬结果编辑');
  const batch=applyPayrollReview(reviewBatch(s,month,expectedVersion),s.session!.username);
  set({batches:{...s.batches,[month]:batch},...(s.month===month?{batch}:{})});
 },
 archivePayroll:(month,expectedVersion)=>{
  const s=get();requirePayrollPermission(s,'薪酬归档');
  const current=reviewBatch(s,month,expectedVersion);
  if(current.review?.dirty) throw new Error('还有未应用的明细修订，请先应用到员工月薪汇总');
  if(!current.salaries.length || current.salaries.some(salary=>!Number.isFinite(salary.total) || salary.total<0) || (current.compensationResult && !current.compensationResult.rows.length)) throw new Error('核算结果不完整，不能归档');
  const issue=payrollBatchInputIssue(s,current);if(issue) throw new Error(issue);
  const archivedAt=auditTime(),archivedBy=s.session!.username;
  const batch:Batch={...current,status:'已锁定',archivedAt,archivedBy,logs:[...current.logs,`${archivedAt} ${archivedBy} 已确认并归档 ${month} 薪酬结果`]};
  set({batch:s.month===month?batch:s.batch,batches:{...s.batches,[month]:batch},archivedMonths:[...new Set([...s.archivedMonths,month])]});
 },
 lockBatch:()=>{
  const s=get();requirePayrollPermission(s,'薪酬归档');if(!s.batch || s.batch.month!==s.month || s.batch.status!=='已核算') throw new Error('请先核算工资');
  if(!s.archivedMonths.includes(s.month)) {s.archivePayroll(s.month,s.batch.review?.version??0);return;}
  // Earlier DEMO versions archived during calculation. Keep their frozen history compatible.
  if(!s.batch.snapshot) throw new Error('核算批次缺少冻结归档依据');
  const batch:Batch={...s.batch,status:'已锁定'};set({batch,batches:{...s.batches,[batch.month]:batch}});
 },
 publishBatch:()=>{
  const s=get();requirePayrollPermission(s,'工资发布');if(!s.batch || s.batch.month!==s.month || s.batch.status==='已发布' || !s.archivedMonths.includes(s.month) || !s.batch.snapshot) throw new Error('请先归档工资再发布');
  const batch:Batch={...s.batch,status:'已发布'};set({batch,batches:{...s.batches,[batch.month]:batch}});
 },
 sync:()=>{
  const s=get();requireOpenMonth(s.month,s.archivedMonths);
  const simulated=fillSimulatedHours({collectAds:false,month:s.month,products:s.products,rooms:s.rooms,records:s.liveRecords,adHours:s.adHours,roomHours:s.roomHours});
  const added=simulated.addedRoomHours;
  set({adHours:simulated.adHours,roomHours:simulated.roomHours,revision:s.revision+(added?1:0),syncTime:new Date().toLocaleString('sv-SE').slice(0,16),toast:`${s.month} 模拟同步完成：补齐 ${simulated.addedRoomHours} 条直播间虚构小时数据`});
 },
 setPerspective:perspective=>{if(get().session?.kind!=='admin')return;set({perspective,page:perspective==='employee'?'profile':'operations'});},
}),{
 name:'meimei-staffhub-department-rules-v1',
 version:1,
 migrate:persisted=>migrateOperationsState(persisted) as ReturnType<typeof initial>,
 merge:(persisted,current)=>{
  const saved=(persisted??{}) as Partial<Hub>;
  const compensationRules=(saved.compensationRules??(saved.compensationInitialized?[]:initialCompensationRules(saved.rooms??current.rooms))).map(normalizeCurrentCompensationRule);
  return {...current,...saved,employees:(saved.employees??current.employees).map(withEmployeeDefaults),roles:migratePayrollRoles(saved.roles??current.roles),datasetsByMonth:saved.datasetsByMonth??{},compensationInitialized:true,compensationRules,compensationTasks:saved.compensationTasks??[],reportHours:saved.reportHours??[],reportDays:saved.reportDays??[],reportOverrides:saved.reportOverrides??[],reportAudit:saved.reportAudit??[]};
 },
 storage:createJSONStorage(()=>typeof localStorage!=='undefined'?localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}),
 partialize:s=>({month:s.month,batches:s.batches,employees:s.employees,departments:s.departments,products:s.products.map(safeProduct),rooms:s.rooms,liveRecords:s.liveRecords,adHours:s.adHours,roomHours:s.roomHours,archivedMonths:s.archivedMonths,liveDetails:s.liveDetails,monthlyRows:s.monthlyRows,detailOverrides:s.detailOverrides,monthlyOverrides:s.monthlyOverrides,correctionAudit:s.correctionAudit,reportHours:s.reportHours,reportDays:s.reportDays,reportOverrides:s.reportOverrides,reportAudit:s.reportAudit,departmentRules:s.departmentRules,payrollTasks:s.payrollTasks,compensationInitialized:s.compensationInitialized,compensationRules:s.compensationRules,compensationTasks:s.compensationTasks,dataset:s.dataset,datasetsByMonth:s.datasetsByMonth,roles:s.roles,revision:s.revision,batch:s.batch,syncTime:s.syncTime}),
}));
