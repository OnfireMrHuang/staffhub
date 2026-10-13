import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { calculate, clean, validateRule } from './domain';
import type { Department, Employee, Fact, HourlyRule, Project, Salary, Scheme, WorkRow } from './domain';
import { seedDepartments, seedEmployees, seedFacts, seedFields, seedProjects, seedRules, seedScheme } from './seed';
import { authenticatePassword, authenticateSso } from './auth';
import type { DemoSession } from './auth';
export type Page = 'operations' | 'employees' | 'departments' | 'rules' | 'payroll' | 'profile' | 'roles';
export interface Batch { month: string; status: '已核算' | '已锁定' | '已发布'; salaries: Salary[]; datasetVersion: number; ruleVersion: number; created: string; logs: string[] }
export interface DatasetField {name:string;field:string;mapping:string}
export interface Role {id:string;name:string;description:string;permissions:string[]}
interface Hub {
 session:DemoSession|null;
 loginPassword:(username:string,password:string)=>void; loginSso:(platform:string,employeeId:string)=>void; logout:()=>void;
 page: Page; opsTab: string; month: string; employees: Employee[]; departments: Department[]; projects: Project[]; facts: Fact[]; rules: HourlyRule[]; scheme: Scheme;
 dataset: {rows:WorkRow[];month:string;version:number;revision:number;published:boolean}; fields: DatasetField[]; roles:Role[]; revision:number; batch:Batch|null; batches:Record<string,Batch>; syncTime:string; toast:string; perspective:'admin'|'employee';
 navigate:(page:Page,tab?:string)=>void; setMonth:(month:string)=>void; notify:(text:string)=>void; reset:()=>void;
 saveEmployee:(employee:Employee)=>void; saveDepartment:(department:Department)=>void; saveProject:(project:Project)=>void; saveFacts:(facts:Fact[])=>void;
 cleanDataset:()=>void; saveFields:(fields:DatasetField[])=>void; saveRole:(role:Role)=>void; saveRules:(rules:HourlyRule[],scheme:Scheme)=>void; runPayroll:()=>void; lockBatch:()=>void; publishBatch:()=>void; sync:()=>void; setPerspective:(value:'admin'|'employee')=>void;
}
const initial = () => ({page:'operations' as Page,opsTab:'datasets',month:'2026-09',employees:structuredClone(seedEmployees),departments:structuredClone(seedDepartments),projects:structuredClone(seedProjects),facts:structuredClone(seedFacts),rules:structuredClone(seedRules),scheme:structuredClone(seedScheme),dataset:{rows:clean(seedFacts,seedEmployees,seedDepartments,'2026-09'),month:'2026-09',version:1,revision:1,published:true},fields:structuredClone(seedFields),roles:[{id:'employee',name:'员工',description:'查看本人资料与已发布工资',permissions:['本人资料','本人薪资条']},{id:'hr',name:'HR',description:'维护部门、员工档案及平台身份',permissions:['员工管理','部门管理','身份绑定']},{id:'ops',name:'数据运营',description:'维护投放项目与运营业务数据',permissions:['投放项目','数据录入','数据集配置']},{id:'salary',name:'薪酬核算',description:'配置薪酬方案并核算发布工资',permissions:['薪酬规则','薪酬核算','工资发布','工资导出']}],revision:1,batch:null as Batch|null,batches:{} as Record<string,Batch>,syncTime:'2026-10-12 17:00',toast:'',perspective:'admin' as const});
export const useHub = create<Hub>()(persist((set,get)=>({
 session:null,
 loginPassword:(username,password)=>{const session=authenticatePassword(username,password,get().employees);set({session,perspective:session.kind,page:session.kind==='admin'?'operations':'profile',toast:''});},
 loginSso:(platform,employeeId)=>{const session=authenticateSso(platform,employeeId,get().employees);set({session,perspective:'employee',page:'profile',toast:''});},
 logout:()=>set({session:null,perspective:'admin',page:'operations',toast:''}),
 ...initial(),
 navigate:(page,tab)=>set({page,...(tab?{opsTab:tab}:{})}), setMonth:month=>set({month,batch:get().batches[month]??null}),notify:toast=>set({toast}),reset:()=>set(initial()),
 saveEmployee:employee=>{const s=get();set({employees:s.employees.some(e=>e.id===employee.id)?s.employees.map(e=>e.id===employee.id?employee:e):[...s.employees,employee],revision:s.revision+1});},
 saveDepartment:department=>{const s=get();set({departments:s.departments.some(d=>d.id===department.id)?s.departments.map(d=>d.id===department.id?department:d):[...s.departments,department],revision:s.revision+1});},
 saveProject:project=>{const s=get();set({projects:s.projects.some(p=>p.id===project.id)?s.projects.map(p=>p.id===project.id?project:p):[...s.projects,project],revision:s.revision+1});},
 saveFacts:facts=>{const s=get();set({facts:[...s.facts,...facts],revision:s.revision+1});},
 cleanDataset:()=>{const s=get();const rows=clean(s.facts,s.employees,s.departments,s.month);if(!rows.length)throw new Error('当前月份没有来源数据');set({dataset:{rows,month:s.month,version:s.dataset.version+1,revision:s.revision,published:true}});},
 saveFields:fields=>set({fields,revision:get().revision+1}),
 saveRole:role=>{const s=get();set({roles:s.roles.some(r=>r.id===role.id)?s.roles.map(r=>r.id===role.id?role:r):[...s.roles,role]});},
 saveRules:(rules,scheme)=>{rules.forEach(validateRule);const s=get();calculate(s.dataset.rows,s.employees,s.departments,scheme,rules,s.dataset.month);set({rules:rules.map(r=>({...r,version:r.version+1})),scheme:{...scheme,version:s.scheme.version+1}});},
 runPayroll:()=>{
   const s=get();
   if(s.batch?.month===s.month && s.batch.status!=='已核算') throw new Error('该月份工资已锁定，不能覆盖；可重置演示重新体验');
   if(s.dataset.revision!==s.revision || s.dataset.month!==s.month) throw new Error('来源或员工资料已变化，请重新清洗数据集');
   if(!s.dataset.published) throw new Error('请先发布运营数据集');
   const salaries=calculate(s.dataset.rows,s.employees,s.departments,s.scheme,s.rules,s.month);
   const batch:Batch={month:s.month,status:'已核算',salaries:structuredClone(salaries),datasetVersion:s.dataset.version,ruleVersion:s.scheme.version,created:new Date().toLocaleString('sv-SE').slice(0,19),logs:[`检查物理表：来源版本 ${s.revision} 已确认`,`读取运营数据集 v${s.dataset.version}，${s.dataset.rows.length} 条员工项目记录`,`过滤适用部门：${s.scheme.departmentIds.map(id=>s.departments.find(d=>d.id===id)?.name).join('、')}，${salaries.length} 位员工`,`项目集基础值汇总 → 重算 ROI、时耗 → 时薪枚举匹配`,`月薪目标 v${s.scheme.version}：固定薪资 + 项目集提成；保存员工与规则快照`]};set({batch,batches:{...s.batches,[s.month]:batch}});
 },
 lockBatch:()=>{const s=get();if(!s.batch || s.batch.status!=='已核算')throw new Error('请先核算工资');if(s.dataset.revision!==s.revision||s.batch.datasetVersion!==s.dataset.version||s.batch.ruleVersion!==s.scheme.version)throw new Error('核算依据已变化，请重新核算后锁定');const batch:Batch={...s.batch,status:'已锁定'};set({batch,batches:{...s.batches,[batch.month]:batch}});},
 publishBatch:()=>{const s=get();if(!s.batch || s.batch.status!=='已锁定')throw new Error('请先锁定工资再发布');const batch:Batch={...s.batch,status:'已发布'};set({batch,batches:{...s.batches,[batch.month]:batch}});},
 sync:()=>set({syncTime:new Date().toLocaleString('sv-SE').slice(0,16)}),setPerspective:perspective=>{if(get().session?.kind!=='admin')return;set({perspective,page:perspective==='employee'?'profile':'operations'});},
}),{name:'meimei-staffhub-demo-real-v3',storage:createJSONStorage(()=> typeof localStorage!=='undefined'?localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}),partialize:s=>({month:s.month,batches:s.batches,employees:s.employees,departments:s.departments,projects:s.projects,facts:s.facts,rules:s.rules,scheme:s.scheme,dataset:s.dataset,fields:s.fields,roles:s.roles,revision:s.revision,batch:s.batch,syncTime:s.syncTime})}));
