export type Model = 'ad' | 'live' | 'premium' | 'schedule' | 'performance';
export type Metric = 'roi' | 'hourlySpend' | 'spend';
export interface Department { id: string; name: string; active: boolean }
export interface Employee { id: string; name: string; departmentId: string; position: string; joined: string; status: '在职' | '待入职' | '已离职'; phone: string; email: string; identities: string[]; role: string; fixedSalary?: number }
export interface Project { id: string; name: string; code: string; account: string; platform: string; active: boolean; liveAccountIds: string[]; access?:{appId:string;secretConfigured:boolean;authCodeConfigured?:boolean} }
export interface Fact { id: string; key: string; version: number; model: Model; employeeId: string; projectId: string; month: string; amount: number; confirmed: boolean }
export interface WorkRow { employeeId: string; employeeName: string; departmentId: string; departmentName: string; projectId: string; month: string; hours: number; spend: number; premium: number; roi: number; hourlySpend: number }
export interface Band { min?: number; max?: number; exact?: number; includeMin: boolean; includeMax: boolean; rate: number }
export interface HourlyRule { id: string; name: string; version: number; mode: 'single' | 'add'; measures: { metric: Metric; bands: Band[] }[]; floor?:{roiBelow:number;rate:number}; sourceNote?:string }
export interface ProjectGroup { id: string; name: string; projectIds: string[]; hourlyRuleId: string }
export interface Scheme { name: string; version: number; fixedSalary: number; departmentIds: string[]; groups: ProjectGroup[]; employeeIds?:string[] }
export interface SalaryDetail { groupId: string; groupName: string; projectIds: string[]; hours: number; spend: number; premium: number; roi: number; hourlySpend: number; rate: number; commission: number; matches: {metric: Metric; input: number; rate: number}[]; ruleName: string; ruleVersion: number }
export interface Salary { employeeId: string; employeeName: string; departmentName: string; fixed: number; commission: number; total: number; details: SalaryDetail[] }
export const metricNames: Record<Metric, string> = {roi: 'ROI', hourlySpend: '时耗', spend: '消耗'};
export const modelNames: Record<Model, string> = {ad: '广告投放', live: '直播间', premium: '保费', schedule: '主播排班', performance: '绩效评估'};
const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const contains = (v: number, b: Band) => b.exact !== undefined ? v === b.exact : (b.min === undefined || (b.includeMin ? v >= b.min : v > b.min)) && (b.max === undefined || (b.includeMax ? v <= b.max : v < b.max));
export function matchRate(value: number, bands: Band[]): number {
  const matches = bands.filter(b => contains(value, b));
  if (!Number.isFinite(value) || !matches.length) throw new Error(`数值 ${value} 未命中时薪区间`);
  if (matches.length > 1) throw new Error('时薪区间重叠，无法唯一匹配');
  return matches[0].rate;
}
export function validateRule(rule: HourlyRule): void {
  if(rule.floor && (!Number.isFinite(rule.floor.roiBelow)||rule.floor.roiBelow<0||!Number.isFinite(rule.floor.rate)||rule.floor.rate<0)) throw new Error('低 ROI 固定时薪与门槛必须是有限非负数');
  if (!rule.measures.length || (rule.mode === 'single' && rule.measures.length !== 1) || (rule.mode === 'add' && rule.measures.length < 2)) throw new Error('请选择与计算方式对应的指标数量');
  if (new Set(rule.measures.map(m => m.metric)).size !== rule.measures.length) throw new Error('计算指标不能重复');
  for (const measure of rule.measures) {
    if (!measure.bands.length) throw new Error('时薪枚举不能为空');
    for (const b of measure.bands) {
      if (!Number.isFinite(b.rate) || b.rate < 0 || [b.min,b.max,b.exact].some(v=>v !== undefined && !Number.isFinite(v))) throw new Error('枚举数值无效');
      if (b.exact === undefined && b.min === undefined && b.max === undefined) throw new Error('范围必须至少有一个边界');
      if (b.exact === undefined && b.min !== undefined && b.max !== undefined && (b.min > b.max || (b.min === b.max && !(b.includeMin && b.includeMax)))) throw new Error('区间范围无效');
    }
    for (let i=0;i<measure.bands.length;i++) for(let j=i+1;j<measure.bands.length;j++) {
      const a=measure.bands[i], b=measure.bands[j];
      const lo=Math.max(a.exact ?? a.min ?? -Infinity,b.exact ?? b.min ?? -Infinity);
      const hi=Math.min(a.exact ?? a.max ?? Infinity,b.exact ?? b.max ?? Infinity);
      if (lo<hi || (lo===hi && contains(lo,a) && contains(lo,b))) throw new Error(`${metricNames[measure.metric]} 枚举范围重叠`);
    }
  }
}
export function calculate(rows: WorkRow[], employees: Employee[], departments: Department[], scheme: Scheme, rules: HourlyRule[], month: string): Salary[] {
  if (!scheme.departmentIds.length) throw new Error('月薪目标必须选择具体部门');
  if (!Number.isFinite(scheme.fixedSalary) || scheme.fixedSalary<0) throw new Error('固定薪资无效');
  const projects=scheme.groups.flatMap(g=>g.projectIds);
  if(new Set(projects).size!==projects.length) throw new Error('项目集存在重复项目');
  scheme.groups.forEach(g=>{
    const rule=rules.find(r=>r.id===g.hourlyRuleId);
    if(!rule) throw new Error('项目集未绑定有效时薪规则');
    validateRule(rule);
  });
  const staff=employees.filter(e=>e.status==='在职' && scheme.departmentIds.includes(e.departmentId) && (!scheme.employeeIds || scheme.employeeIds.includes(e.id)));
  if(!staff.length) throw new Error('目标部门没有适用员工');
  return staff.map(e=>{
    const selected=rows.filter(r=>r.employeeId===e.id && r.departmentId===e.departmentId && scheme.departmentIds.includes(r.departmentId) && r.month===month);
    if(!selected.length) throw new Error(`${e.name} 缺少工作数据，请前往数据录入核对`);
    if(new Set(selected.map(r=>r.projectId)).size!==selected.length) throw new Error(`${e.name} 数据集基础粒度重复`);
    if(selected.some(r=>!projects.includes(r.projectId))) throw new Error(`${e.name} 存在未分类项目`);
    const details=scheme.groups.flatMap(g=>{
      const work=selected.filter(r=>g.projectIds.includes(r.projectId));
      if(!work.length) return [];
      const hours=work.reduce((s,r)=>s+r.hours,0), spend=work.reduce((s,r)=>s+r.spend,0),premium=work.reduce((s,r)=>s+r.premium,0);
      if([hours,spend,premium].some(v=>!Number.isFinite(v)||v<0)) throw new Error(`${e.name} 存在无效基础数据`);
      if(hours===0 && spend===0 && premium===0) return [];
      if(hours<=0) throw new Error(`${e.name} 直播时长为零，请核对`);
      if(spend<=0) throw new Error(`${e.name} 消耗为零，无法计算 ROI`);
      const roi=premium/spend, hourlySpend=spend/hours;
      const rule=rules.find(r=>r.id===g.hourlyRuleId)!;
      const inputs={roi,hourlySpend,spend};
      const matches=rule.floor && roi<rule.floor.roiBelow ? [{metric:'roi' as Metric,input:roi,rate:rule.floor.rate}] : rule.measures.map(m=>({metric:m.metric,input:inputs[m.metric],rate:matchRate(inputs[m.metric],m.bands)}));
      const rate=matches.reduce((s,m)=>s+m.rate,0);
      return [{groupId:g.id,groupName:g.name,projectIds:work.map(r=>r.projectId),hours,spend,premium,roi,hourlySpend,rate,commission:money(rate*hours),matches,ruleName:rule.name,ruleVersion:rule.version}];
    });
    const fixed=e.fixedSalary ?? scheme.fixedSalary,commission=money(details.reduce((s,d)=>s+d.commission,0));
    return {employeeId:e.id,employeeName:e.name,departmentName:departments.find(d=>d.id===e.departmentId)?.name ?? e.departmentId,fixed,commission,total:money(fixed+commission),details};
  });
}
export function clean(facts: Fact[], employees: Employee[], departments: Department[], month: string): WorkRow[] {
  const latest=new Map<string,Fact>();
  for(const f of facts) {
    const key=`${f.model}:${f.key}`;
    if(!latest.has(key) || latest.get(key)!.version<f.version) latest.set(key,f);
  }
  const effective=[...latest.values()].filter(f=>f.month===month);
  if(effective.some(f=>!f.confirmed)) throw new Error('存在未确认的业务记录，请先完成数据确认');
  if(effective.some(f=>!Number.isFinite(f.amount)||f.amount<0)) throw new Error('原始记录金额或时长无效');
  const groups=new Map<string,Fact[]>();
  effective.forEach(f=>{const key=`${f.employeeId}:${f.projectId}`;groups.set(key,[...(groups.get(key) ?? []),f]);});
  return [...groups.values()].map(group=>{
    const e=employees.find(e=>e.id===group[0].employeeId);
    if(!e) throw new Error('来源记录的员工归属无效');
    const sum=(model:Model)=>group.filter(f=>f.model===model).reduce((s,f)=>s+f.amount,0);
    for(const required of ['ad','live','premium','schedule'] as Model[]) if(!group.some(f=>f.model===required)) throw new Error(`${e.name} 缺少 ${modelNames[required]} 来源数据`);
    const hours=sum('schedule'),spend=sum('ad'),premium=sum('premium');
    if(hours>sum('live')) throw new Error(`${e.name} 确认计薪时长超过直播时长`);
    if(hours<=0 || spend<=0) throw new Error(`${e.name} 时长或消耗为零，需核对`);
    return {employeeId:e.id,employeeName:e.name,departmentId:e.departmentId,departmentName:departments.find(d=>d.id===e.departmentId)?.name ?? e.departmentId,projectId:group[0].projectId,month,hours,spend,premium,roi:premium/spend,hourlySpend:spend/hours};
  });
}
