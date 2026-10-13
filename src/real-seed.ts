import type { Department, Employee, Project, Fact, Scheme } from './domain';
import performance from './data/performance.json';
import { actualRules, salarySource } from './data/salary-standards';
export const sources = [
 {title:'各直播间薪资标准',url:salarySource,status:'已读取 · 2026-10-12',note:'17 个直播间标准已登记，6 个明确的 ROI + 时耗基础规则用于试算，特殊条款待配置。'},
 {title:'直播间主播绩效统计',url:performance.sourceUrl,status:'已导入 · 190 条来源记录',note:'34 个项目、150 个独立员工姓名；2026-09 与临时编号按用户确认用于 DEMO。'},
];
export const sourcePerformance = performance;
export const pendingRecords=performance.records.filter(r=>r.joint||r.premiumLabel!=='年化保费');
const usable=performance.records.filter(r=>!r.joint&&r.premiumLabel==='年化保费');
const names=[...new Set(performance.records.filter(r=>!r.joint).map(r=>r.employeeName))];
const employeeMap=new Map(names.map((name,i)=>[name,`MM${String(i+1).padStart(4,'0')}`]));
const projectNames=performance.totals.map(r=>r.project);
const projectMap=new Map(projectNames.map((name,i)=>[name,`p${i+1}`]));
export const seedDepartments:Department[]=[{id:'live',name:'直播部',active:true},{id:'ads',name:'投放部',active:true},{id:'creative',name:'素材部',active:true}];
export const seedProjects:Project[]=projectNames.map((name,i)=>({id:projectMap.get(name)!,name,code:`XM${String(i+1).padStart(3,'0')}`,account:'待关联真实账户',platform:name.includes('快手')?'快手（来源渠道）':'巨量营销 / 巨量千川',active:true,liveAccountIds:[]}));
export const seedRules=actualRules;
const definitions:[string,string,string[]][]=[
 ['g1','E生保项目集',['平安健康-E生保','平安健康-E生保2号']],
 ['g2','就医无忧保项目集',['众安-就医无忧保']],
 ['g3','尊享E生项目集',['众安-尊享E生']],
 ['g4','众民保百万医疗项目集',['众安-众民保百万医疗']],
 ['g5','太平洋免健告项目集',['太平洋-长期医疗免健告版']],
 ['g6','总部普惠保项目集',['平安财-总部普惠保']],
];
const groups=definitions.map(([id,name,projects],i)=>({id,name,projectIds:projects.map(p=>projectMap.get(p)!),hourlyRuleId:actualRules[i].id}));
const covered=new Set(groups.flatMap(g=>g.projectIds));
export const eligibleEmployeeIds=names.filter(name=>{const work=usable.filter(r=>r.employeeName===name);return work.length>0&&work.every(r=>covered.has(projectMap.get(r.project)!))}).map(name=>employeeMap.get(name)!);
export const seedEmployees:Employee[]=names.map(name=>({id:employeeMap.get(name)!,name,departmentId:'live',position:'主播',joined:'',status:'在职' as const,phone:'',email:'',identities:['飞书'],role:'员工'})).sort((a,b)=>Number(eligibleEmployeeIds.includes(b.id))-Number(eligibleEmployeeIds.includes(a.id))||a.id.localeCompare(b.id));
export const seedFacts:Fact[]=usable.flatMap(r=>(['ad','live','premium','schedule'] as const).map(model=>({id:`source-${r.sourceRow}-${model}-v1`,key:`source-${r.sourceRow}-${model}`,version:1,model,employeeId:employeeMap.get(r.employeeName)!,projectId:projectMap.get(r.project)!,month:'2026-09',amount:model==='ad'?r.spend!:model==='premium'?r.premium!:model==='live'?r.listedHours!:r.actualHours!,confirmed:true})));
export const seedScheme:Scheme={name:'主播基础规则试算方案',version:1,fixedSalary:0,departmentIds:['live'],employeeIds:eligibleEmployeeIds,groups};
export const seedFields=[
 {name:'员工 ID',field:'employee_id',mapping:'员工 → 临时演示编号'}, {name:'员工名称',field:'employee_name',mapping:'绩效统计表 → 主播'}, {name:'部门',field:'department_id',mapping:'员工 → 直播部（演示归属）'}, {name:'项目',field:'project_id',mapping:'绩效统计表 → 直播间名称'}, {name:'年份 / 月份',field:'period',mapping:'2026-09（用户确认演示月份）'}, {name:'直播时长',field:'live_hours',mapping:'绩效统计表 → 实际时长'}, {name:'消耗',field:'ad_spend',mapping:'绩效统计表 → 消耗'}, {name:'年化保费',field:'premium',mapping:'绩效统计表 → 年化保费'}, {name:'ROI',field:'roi',mapping:'年化保费 ÷ 消耗，使用未舍入值'}, {name:'时耗',field:'hourly_spend',mapping:'消耗 ÷ 实际时长（按规格重算）'},
];
