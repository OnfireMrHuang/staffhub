import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { calculate, validateRule } from './domain';
import type { Department, Employee, HourlyRule, Project, Salary, Scheme, WorkRow } from './domain';
import { seedDepartments, seedEmployees, seedRules } from './seed';
import { demoAdHours, demoMonth, demoProjects, demoRecords, demoRoomHours, demoScheme } from './live-seed';
import { buildLiveStatistics, validateLiveRecord } from './live-domain';
import { fillSimulatedHours } from './live-sync';
import type { AdHourly, LiveDetail, LiveMonthly, LiveRecord, RoomHourly } from './live-domain';
import { authenticatePassword, authenticateSso } from './auth';
import type { DemoSession } from './auth';

export type Page = 'operations' | 'employees' | 'departments' | 'rules' | 'payroll' | 'profile' | 'roles';
export interface Dataset { rows:WorkRow[]; month:string; version:number; revision:number; published:boolean }
export interface PayrollSnapshot {
 records:LiveRecord[]; adHours:AdHourly[]; roomHours:RoomHourly[];
 employees:Employee[]; departments:Department[]; projects:Project[]; rules:HourlyRule[]; scheme:Scheme;
 details:LiveDetail[]; monthly:LiveMonthly[]; dataset:Dataset;
}
export interface Batch { month:string; status:'已核算'|'已锁定'|'已发布'; salaries:Salary[]; datasetVersion:number; ruleVersion:number; created:string; logs:string[]; snapshot:PayrollSnapshot }
export interface Role { id:string; name:string; description:string; permissions:string[] }
interface Hub {
 session:DemoSession|null;
 loginPassword:(username:string,password:string)=>void; loginSso:(platform:string,employeeId:string)=>void; logout:()=>void;
 page:Page; opsTab:string; month:string; employees:Employee[]; departments:Department[]; projects:Project[]; rules:HourlyRule[]; scheme:Scheme;
 liveRecords:LiveRecord[]; adHours:AdHourly[]; roomHours:RoomHourly[]; archivedMonths:string[]; liveDetails:LiveDetail[]; monthlyRows:LiveMonthly[];
 dataset:Dataset; roles:Role[]; revision:number; batch:Batch|null; batches:Record<string,Batch>; syncTime:string; toast:string; perspective:'admin'|'employee';
 navigate:(page:Page,tab?:string)=>void; setMonth:(month:string)=>void; notify:(text:string)=>void; reset:()=>void;
 saveEmployee:(employee:Employee)=>void; saveDepartment:(department:Department)=>void; saveProject:(project:Project)=>void; saveLiveRecords:(records:LiveRecord[])=>void;
 cleanDataset:()=>void; saveRole:(role:Role)=>void; saveRules:(rules:HourlyRule[],scheme:Scheme)=>void;
 runPayroll:()=>void; lockBatch:()=>void; publishBatch:()=>void; sync:()=>void; setPerspective:(value:'admin'|'employee')=>void;
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
const safeProject = (project:Project):Project => ({
 id:project.id, name:project.name, code:project.code, account:project.account, platform:project.platform, active:project.active,
 liveAccountIds:[...project.liveAccountIds],
 ...(project.access ? {access:{appId:project.access.appId,secretConfigured:project.access.secretConfigured,authCodeConfigured:!!project.access.authCodeConfigured}} : {}),
});
const initial = () => {
 const employees=structuredClone(seedEmployees),departments=structuredClone(seedDepartments),projects=structuredClone(demoProjects);
 const liveRecords=structuredClone(demoRecords),adHours=structuredClone(demoAdHours),roomHours=structuredClone(demoRoomHours);
 const {details,monthly}=buildLiveStatistics(liveRecords,roomHours,employees,departments,projects,demoMonth);
 return {
  page:'operations' as Page,opsTab:'datasets',month:demoMonth,employees,departments,projects,liveRecords,adHours,roomHours,
  rules:structuredClone(seedRules),scheme:structuredClone(demoScheme),archivedMonths:[] as string[],liveDetails:details,monthlyRows:monthly,
  dataset:{rows:monthly,month:demoMonth,version:1,revision:1,published:true},
  roles:[
   {id:'employee',name:'员工',description:'查看本人资料与已发布工资',permissions:['本人资料','本人薪资条']},
   {id:'hr',name:'HR',description:'维护部门、员工档案及平台身份',permissions:['员工管理','部门管理','身份绑定']},
   {id:'ops',name:'数据运营',description:'维护投放项目与运营业务数据',permissions:['投放项目','数据录入','运营数据集']},
   {id:'salary',name:'薪酬核算',description:'配置薪酬方案并核算发布工资',permissions:['薪酬规则','薪酬核算','工资发布','工资导出']},
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
  if(batch && s.archivedMonths.includes(month)) {
   const snapshot=structuredClone(batch.snapshot);
   set({month,batch,dataset:snapshot.dataset,liveDetails:snapshot.details,monthlyRows:snapshot.monthly});
  } else {
   set({month,batch,liveDetails:[],monthlyRows:[],dataset:{rows:[],month,version:s.dataset.version,revision:-1,published:false}});
  }
 },
 notify:toast=>set({toast}),reset:()=>set(initial()),
 saveEmployee:employee=>{
  const s=get(),name=normalText(employee.name);
  if(!name) throw new Error('员工姓名不能为空');
  if(s.employees.some(e=>e.id!==employee.id && normalText(e.name)===name)) throw new Error('员工姓名必须全局唯一（包含已离职员工）');
  const saved=structuredClone({...employee,name});
  set({employees:s.employees.some(e=>e.id===saved.id)?s.employees.map(e=>e.id===saved.id?saved:e):[...s.employees,saved],revision:s.revision+1});
 },
 saveDepartment:department=>{
  const s=get(),saved=structuredClone(department);
  set({departments:s.departments.some(d=>d.id===saved.id)?s.departments.map(d=>d.id===saved.id?saved:d):[...s.departments,saved],revision:s.revision+1});
 },
 saveProject:project=>{
  const s=get(),code=normalText(project.code),name=normalText(project.name),account=normalText(project.account);
  if(!code) throw new Error('项目编码不能为空');
  if(!name) throw new Error('项目名称不能为空');
  if(s.projects.some(p=>p.id!==project.id && normalText(p.code)===code)) throw new Error('项目编码必须唯一');
  if(!['巨量引擎','磁力引擎','腾讯 ADQ'].includes(project.platform)) throw new Error('请选择有效的平台');
  const liveAccountIds=[...new Set(project.liveAccountIds.map(normalText).filter(Boolean))];
  if(!account || !liveAccountIds.length) throw new Error('请填写投放账户及至少一个直播账户');
  const old=s.projects.find(p=>p.id===project.id);
  const hasHistory=s.liveRecords.some(r=>r.projectId===project.id)||s.adHours.some(r=>r.projectId===project.id)||s.roomHours.some(r=>r.projectId===project.id);
  if(old && old.code!==code && hasHistory) throw new Error('项目已有来源历史，不能改变项目编码');
  if(old && hasHistory) {
   const oldAccounts=new Set(old.liveAccountIds.map(normalText));
   const sameAccounts=oldAccounts.size===liveAccountIds.length && liveAccountIds.every(id=>oldAccounts.has(id));
   if(old.platform!==project.platform || normalText(old.account)!==account || !sameAccounts) throw new Error('已有来源历史，平台及账户绑定不可直接更改，请新建项目');
  }
  const saved=safeProject({...project,code,name,account,liveAccountIds});
  set({projects:s.projects.some(p=>p.id===saved.id)?s.projects.map(p=>p.id===saved.id?saved:p):[...s.projects,saved],revision:s.revision+1});
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
  }
  const merged=[...s.liveRecords.filter(r=>!ids.has(r.id)),...incoming];
  for(const record of incoming) {
   validateLiveRecord(record,s.employees,s.projects,merged,s.archivedMonths);
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
  const {details,monthly}=buildLiveStatistics(s.liveRecords,s.roomHours,s.employees,s.departments,s.projects,s.month);
  if(!monthly.length) throw new Error('当前月份没有直播来源数据');
  set({liveDetails:details,monthlyRows:monthly,dataset:{rows:monthly,month:s.month,version:s.dataset.version+1,revision:s.revision,published:true}});
 },
 saveRole:role=>{const s=get(),saved=structuredClone(role);set({roles:s.roles.some(r=>r.id===role.id)?s.roles.map(r=>r.id===role.id?saved:r):[...s.roles,saved]});},
 saveRules:(rules,scheme)=>{
  rules.forEach(validateRule);const s=get();
  calculate(s.dataset.rows,s.employees,s.departments,scheme,rules,s.dataset.month);
  set({rules:structuredClone(rules.map(r=>({...r,version:r.version+1}))),scheme:structuredClone({...scheme,version:s.scheme.version+1})});
 },
 runPayroll:()=>{
  const s=get();requireOpenMonth(s.month,s.archivedMonths);
  if(s.dataset.revision!==s.revision || s.dataset.month!==s.month) throw new Error('来源或员工资料已变化，请重新统计运营数据集');
  if(!s.dataset.published) throw new Error('请先刷新运营数据集');
  const salaries=calculate(s.dataset.rows,s.employees,s.departments,s.scheme,s.rules,s.month);
  const snapshot:PayrollSnapshot=structuredClone({
   records:s.liveRecords.filter(r=>r.date.startsWith(s.month+'-')),adHours:s.adHours.filter(r=>r.date.startsWith(s.month+'-')),roomHours:s.roomHours.filter(r=>r.date.startsWith(s.month+'-')),
   employees:s.employees,departments:s.departments,projects:s.projects.map(safeProject),rules:s.rules,scheme:s.scheme,details:s.liveDetails,monthly:s.monthlyRows,dataset:s.dataset,
  });
  const batch:Batch={month:s.month,status:'已核算',salaries:structuredClone(salaries),datasetVersion:s.dataset.version,ruleVersion:s.scheme.version,created:new Date().toLocaleString('sv-SE').slice(0,19),snapshot,logs:[
   `模拟来源版本 ${s.revision} 已确认：直播记录与直播间小时数据`,
   `读取固定运营数据集 v${s.dataset.version}，${s.dataset.rows.length} 条员工项目月度记录`,
   `目标方案 ${s.scheme.name}，${salaries.length} 位员工`,
   '项目集汇总 → ROI、时耗 → 时薪枚举匹配 → 固定薪资与提成',
   `${s.month} 核算成功：冻结员工、规则、来源与统计依据并归档`,
  ]};
  set({batch,batches:{...s.batches,[s.month]:batch},archivedMonths:[...new Set([...s.archivedMonths,s.month])]});
 },
 lockBatch:()=>{
  const s=get();if(!s.batch || s.batch.month!==s.month || s.batch.status!=='已核算') throw new Error('请先核算工资');
  if(!s.archivedMonths.includes(s.batch.month)||!s.batch.snapshot) throw new Error('核算批次缺少冻结归档依据');
  const batch:Batch={...s.batch,status:'已锁定'};set({batch,batches:{...s.batches,[batch.month]:batch}});
 },
 publishBatch:()=>{
  const s=get();if(!s.batch || s.batch.month!==s.month || s.batch.status!=='已锁定') throw new Error('请先锁定工资再发布');
  const batch:Batch={...s.batch,status:'已发布'};set({batch,batches:{...s.batches,[batch.month]:batch}});
 },
 sync:()=>{
  const s=get();requireOpenMonth(s.month,s.archivedMonths);
  const simulated=fillSimulatedHours({month:s.month,projects:s.projects,records:s.liveRecords,adHours:s.adHours,roomHours:s.roomHours});
  const added=simulated.addedAdHours+simulated.addedRoomHours;
  set({adHours:simulated.adHours,roomHours:simulated.roomHours,revision:s.revision+(added?1:0),syncTime:new Date().toLocaleString('sv-SE').slice(0,16),toast:`${s.month} 模拟同步完成：补齐 ${simulated.addedAdHours} 条投放、${simulated.addedRoomHours} 条直播间虚构小时数据`});
 },
 setPerspective:perspective=>{if(get().session?.kind!=='admin')return;set({perspective,page:perspective==='employee'?'profile':'operations'});},
}),{
 name:'meimei-staffhub-live-v1',
 storage:createJSONStorage(()=>typeof localStorage!=='undefined'?localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}),
 partialize:s=>({month:s.month,batches:s.batches,employees:s.employees,departments:s.departments,projects:s.projects.map(safeProject),liveRecords:s.liveRecords,adHours:s.adHours,roomHours:s.roomHours,archivedMonths:s.archivedMonths,liveDetails:s.liveDetails,monthlyRows:s.monthlyRows,rules:s.rules,scheme:s.scheme,dataset:s.dataset,roles:s.roles,revision:s.revision,batch:s.batch,syncTime:s.syncTime}),
}));
