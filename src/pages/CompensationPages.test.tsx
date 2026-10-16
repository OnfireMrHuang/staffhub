import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Rules from './Rules';
import RoomRuleSets from './RoomRuleSets';
import Payroll, { CompensationSalaryDetails } from './Payroll';
import { calculateCompensation, type CompensationRule } from '../compensation-rules';
import { useHub } from '../store';
// SSR should render the test's explicit current snapshot rather than Zustand's hydration baseline.
vi.mock('../store',async importOriginal=>{
 const actual=await importOriginal<typeof import('../store')>();
 const current=Object.assign(((selector?:(state:ReturnType<typeof actual.useHub.getState>)=>unknown)=>selector?selector(actual.useHub.getState()):actual.useHub.getState()) as typeof actual.useHub,actual.useHub);
 return {...actual,useHub:current};
});

it('provides scope categories with a single add action and no page-level explanations or month picker',()=>{
 const html=renderToStaticMarkup(<Rules/>);
 expect(html.match(/role="tab"/g)).toHaveLength(3);
 for(const text of ['全局规则','直播间规则','员工规则','新增薪酬规则','补贴规则','系数规则','查看详情','编辑规则']) expect(html).toContain(text);
 expect(html.match(/新增薪酬规则/g)).toHaveLength(1);
 for(const text of ['COMPENSATION RULES','来源与历史规则','规则核算月份','按适用范围配置补贴','补贴 → 系数 → 时薪']) expect(html).not.toContain(text);
 expect(html.indexOf('role="tablist"')).toBeLessThan(html.indexOf('compensation-category'));
 expect(html).toMatch(/<section class="compensation-category" aria-label="全局规则">[\s\S]*?新增薪酬规则/);
});
it('renders one room-set card for all three calculation types with shared actions',()=>{
 const before=useHub.getState(),room=before.rooms[0];
 const common={version:1,status:'草稿' as const,scope:'rooms' as const,roomIds:[room.id],roomRuleSetId:'three-types'};
 const rules:CompensationRule[]=[
  {...common,id:'a',name:'直播间夜班补贴',type:'allowance',allowance:{field:'nightSessions',amount:30}},
  {...common,id:'p',name:'直播间保费系数',type:'premium',premium:{items:[{id:'p1',name:'正常保费',field:'regularPremium',coefficient:1}]}},
  {...common,id:'h',name:'直播间时薪',type:'hourly',hourly:{duration:'hours',items:[{id:'h1',name:'时段加成',kind:'special',rate:60}],formula:{mode:'additions',itemIds:['h1']}}}
 ];
 try{
  useHub.setState({compensationRules:rules});
  const html=renderToStaticMarkup(<RoomRuleSets/>);
  for(const text of ['新增直播间规则集','3 类规则','直播间夜班补贴','直播间保费系数','直播间时薪',room.name])expect(html).toContain(text);
  for(const label of ['查看详情','编辑规则集','>发布<'])expect(html.split(label)).toHaveLength(2);
  expect(html).not.toContain('新增薪酬规则');
 }finally{useHub.setState(before,true)}
});
it('renders frozen merged row calculations including premium transformation and grouped hourly amounts',()=>{
 const s=useHub.getInitialState(),row={...s.monthlyRows[0],hours:10,nightHours:2,earlyHours:2,premium:1000,nightPremium:0,earlyPremium:200,spend:1000,nightSessions:2,earlySessions:1},scope={version:1,status:'已发布' as const,scope:'global' as const,roomIds:[]};
 const rules:CompensationRule[]=[{...scope,id:'allowance',name:'夜班补贴',type:'allowance',allowance:{field:'nightSessions',amount:30}},{...scope,id:'premium',name:'早班系数',type:'premium',premium:{normalField:'regularPremium',earlyField:'earlyPremium',coefficient:1.5,condition:{kind:'group',operator:'and',children:[{kind:'condition',field:'monthly.earlySessions',operator:'gte',value:1}]}}},{...scope,id:'hourly',name:'总时长加成',type:'hourly',hourly:{duration:'hours',items:[{id:'special',name:'常规加成',kind:'special',rate:80}],formula:{mode:'additions',itemIds:['special']}}}];
 const result=calculateCompensation([row],s.employees,s.departments,s.rooms,rules,row.month),salary=result.salaries[0];
 expect(salary.total).toBe(860);
 const historical={...result,settlementVersion:undefined,rows:result.rows.map(row=>({...row,premium:{...row.premium,candidates:undefined}}))};
 const html=renderToStaticMarkup(<CompensationSalaryDetails salary={salary} result={historical} rules={rules}/>);
 for(const text of ['正常保费','有效系数','有效保费','有效 ROI','触发保薪最大值','加成合计','最终时薪','常规加成','夜班','¥860.00','¥1,100.00']) expect(html).toContain(text);
 expect(html).toContain(result.referenceDate); expect(html).toContain(row.roomName);
});
it('payroll displays both task models, withdrawal affordances and a mixed-model block',()=>{
 const before=useHub.getState(),s=useHub.getInitialState(),rule=s.compensationRules[0],legacy=s.departmentRules[0],common={month:s.month,ruleVersion:1,datasetVersion:1,datasetRevision:0,status:'待核算' as const,employeeIds:[s.employees[0].id],created:'2026-10-15'};
 try{
  useHub.setState({batch:null,month:s.month,compensationTasks:[{...common,id:'new',ruleId:rule.id,ruleName:rule.name,scope:rule.scope,type:rule.type,referenceDate:'2026-10-31',rule,rowKeys:['row']}],payrollTasks:[{...common,id:'old',ruleId:legacy.id,ruleName:legacy.name,departmentId:legacy.departmentId,rule:legacy}]});
  const html=renderToStaticMarkup(<Payroll/>);
  for(const text of ['分类 / 类型','适用范围','计算配置','本月核算任务','全局规则 / 补贴规则','旧版任务','先撤回旧版任务','撤回任务','参考日 2026-10-31']) expect(html).toContain(text);
  expect(html.match(/撤回任务/g)).toHaveLength(2);
  expect(html).toMatch(/disabled=""[^>]*><svg[^>]*[\s\S]*?开始月度核算/);
 }finally{useHub.setState(before,true)}
});
