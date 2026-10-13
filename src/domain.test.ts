import { describe, it, expect } from 'vitest';
import { calculate, clean, matchRate, validateRule } from './domain';
import type { Employee, HourlyRule, Scheme, WorkRow, Fact } from './domain';

const staff: Employee[] = [{id:'e1',name:'测试主播',departmentId:'d1',position:'主播',joined:'2025-01-01',status:'在职',phone:'',email:'',identities:[],role:'员工'}, {id:'e2',name:'无关员工',departmentId:'d2',position:'投手',joined:'2025-01-01',status:'在职',phone:'',email:'',identities:[],role:'员工'}];
const departments = [{id:'d1',name:'直播部',active:true},{id:'d2',name:'投放部',active:true}];
const rule: HourlyRule = {id:'h1',name:'测试时薪',version:1,mode:'add',measures:[{metric:'roi',bands:[{min:0,max:1.5,includeMin:true,includeMax:false,rate:40},{min:1.5,includeMin:true,includeMax:false,rate:60}]},{metric:'hourlySpend',bands:[{min:0,includeMin:true,includeMax:false,rate:10}]}]};
const scheme: Scheme = {name:'测试目标',version:1,fixedSalary:5000,departmentIds:['d1'],groups:[{id:'g1',name:'项目集',projectIds:['a','b'],hourlyRuleId:'h1'}]};
const rows: WorkRow[] = [
 {employeeId:'e1',employeeName:'测试主播',departmentId:'d1',departmentName:'直播部',projectId:'a',month:'2026-09',hours:40,spend:100000,premium:100000,roi:1,hourlySpend:2500},
 {employeeId:'e1',employeeName:'测试主播',departmentId:'d1',departmentName:'直播部',projectId:'b',month:'2026-09',hours:60,spend:300000,premium:540000,roi:1.8,hourlySpend:5000},
 {employeeId:'e2',employeeName:'无关员工',departmentId:'d2',departmentName:'投放部',projectId:'a',month:'2026-09',hours:999,spend:999,premium:99999999,roi:999,hourlySpend:1},
];
describe('主播核算口径',()=>{
 it('先合并项目再计算 ROI、时耗及统一时薪，固定薪资只计算一次',()=>{
  const result=calculate(rows,staff,departments,scheme,[rule],'2026-09');
  expect(result).toHaveLength(1); expect(result[0].details[0]).toMatchObject({roi:1.6,hourlySpend:4000,rate:70,hours:100,commission:7000}); expect(result[0].total).toBe(12000);
 });
 it('汇总前排除其他部门及其他月份的记录',()=>{
  const result=calculate([...rows,{...rows[0],month:'2026-08',hours:9000}],staff,departments,scheme,[rule],'2026-09');
  expect(result.map(r=>r.employeeId)).toEqual(['e1']); expect(result[0].commission).toBe(7000);
 });
 it('适用员工缺少数据时阻止生成工资',()=>{expect(()=>calculate([],staff,departments,scheme,[rule],'2026-09')).toThrow('缺少工作数据');});
 it('不允许同一项目属于两个项目集',()=>{expect(()=>calculate(rows,staff,departments,{...scheme,groups:[...scheme.groups,{...scheme.groups[0],id:'g2'}]},[rule],'2026-09')).toThrow('重复');});
 it('不允许空部门范围自动应用全公司',()=>{expect(()=>calculate(rows,staff,departments,{...scheme,departmentIds:[]},[rule],'2026-09')).toThrow('部门');});
 it('没有分类的项目不能静默遗漏',()=>{expect(()=>calculate(rows,staff,departments,{...scheme,groups:[{...scheme.groups[0],projectIds:['a']}]},[rule],'2026-09')).toThrow('未分类');});
 it('零分母不能伪造 ROI 或时耗',()=>{expect(()=>calculate(rows.map(r=>({...r,spend:0})),staff,departments,scheme,[rule],'2026-09')).toThrow('消耗');});
 it('真实条款 ROI 低于门槛时仅取固定时薪，不叠加时耗档位',()=>{const lowRows=rows.map(r=>({...r,premium:0}));const result=calculate(lowRows,staff,departments,scheme,[{...rule,floor:{roiBelow:1.6,rate:60}}],'2026-09');expect(result[0].details[0].rate).toBe(60);expect(result[0].commission).toBe(6000);});
 it('月薪目标显式限定试算员工，未选中员工不进入汇总',()=>{const result=calculate(rows,staff,departments,{...scheme,departmentIds:['d1','d2'],employeeIds:['e1']},[rule],'2026-09');expect(result).toHaveLength(1);expect(result[0].employeeId).toBe('e1');});
});
describe('时薪区间',()=>{
 it('低 ROI 固定时薪与门槛必须是有限非负数',()=>{for(const floor of [{roiBelow:1.6,rate:-60},{roiBelow:NaN,rate:60},{roiBelow:-1,rate:60},{roiBelow:1.6,rate:Infinity}])expect(()=>validateRule({...rule,floor})).toThrow('固定时薪');});
 it('明确执行左闭右开边界',()=>{expect(matchRate(1.5,rule.measures[0].bands)).toBe(60);});
 it('未命中阻止计算而不是取零',()=>{expect(()=>matchRate(-1,rule.measures[0].bands)).toThrow('未命中');});
 it('重叠区间及精确值与范围重叠不能发布',()=>{expect(()=>validateRule({...rule,mode:'single',measures:[{metric:'roi',bands:[...rule.measures[0].bands,{exact:1.6,includeMin:true,includeMax:true,rate:70}]}]})).toThrow('重叠');});
});
describe('物理表清洗',()=>{
 const fact=(model:Fact['model'],amount:number):Fact=>({id:model,key:model,version:1,model,employeeId:'e1',projectId:'a',month:'2026-09',amount,confirmed:true});
 it('同一来源键采用最新版本，累计消耗不累加多次快照',()=>{
  const facts=[fact('ad',10000),{...fact('ad',15000),id:'ad-v2',version:2},fact('live',5),fact('schedule',5),fact('premium',24000)];
  const result=clean(facts,staff,departments,'2026-09'); expect(result).toHaveLength(1); expect(result[0]).toMatchObject({spend:15000,hours:5,premium:24000,roi:1.6});
 });
 it('未确认的排班和保费阻止清洗',()=>{expect(()=>clean([fact('ad',10000),fact('live',5),{...fact('schedule',5),confirmed:false},fact('premium',20000)],staff,departments,'2026-09')).toThrow('未确认');});
 it('记录更正到其他月份后旧月份不再读取旧版本',()=>{const facts=[fact('ad',10000),fact('live',5),fact('schedule',5),fact('premium',24000)];const moved=facts.map(f=>({...f,id:`${f.id}-v2`,month:'2026-10',version:2}));expect(clean([...facts,...moved],staff,departments,'2026-09')).toEqual([]);expect(clean([...facts,...moved],staff,departments,'2026-10')).toHaveLength(1);});
});
