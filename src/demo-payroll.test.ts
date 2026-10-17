import { beforeEach, expect, it } from 'vitest';
import { payrollBatchInputIssue, useHub } from './store';
import { monthlyPayrollTasks } from './payroll-task-view';
import { buildReviewedPayrollWorkbook, payrollDetailKey } from './payroll-review';
import { calculateDemoPayroll } from './demo-payroll';

beforeEach(()=>{
 useHub.getState().reset();
 useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});
 useHub.getState().setMonth('2026-09');
 useHub.getState().ensureMonthlyPayrollJobs(new Date('2026-10-01T00:00:00+08:00'));
});

it('separates hourly performance from allowance before forming demo monthly salary',()=>{
 const s=useHub.getState();
 const source={...s.dataset.rows.find(row=>row.roles.includes('主播'))!,hours:10,nightHours:2,earlyHours:3,nightSessions:2};
 const {result}=calculateDemoPayroll([source],s.employees,s.departments,s.rooms,s.month);
 // One room: 10 hours at 50 + 10 yuan/hour gives 600; two night sessions add 40.
 expect(result.rows[0]).toMatchObject({performance:600,allowance:40,total:640});
 expect(result.salaries[0].total).toBe(640);
});

it('generates explicit demo results even when published rules are blocked by missing inputs',()=>{
 const s=useHub.getState();
 s.saveCompensationRule({id:'blocked-guarantee',name:'缺少历史时薪的保薪',version:1,status:'草稿',scope:'global',roomIds:[],type:'hourly',hourly:{duration:'hours',kind:'guarantee',items:[{id:'g',name:'历史时薪保薪',kind:'guarantee',rateField:'past3MonthsAvgHourlyRate',condition:{kind:'group',operator:'and',children:[{kind:'condition',field:'monthly.hours',operator:'gte',value:0}]}}],formula:{mode:'guarantee',itemId:'g'}}});
 s.publishCompensationRule('blocked-guarantee');
 expect(()=>s.runPayroll()).toThrow(/过去3个月/);
 const before=useHub.getState();
 s.runDemoPayroll();
 const after=useHub.getState(),batch=after.batch!;
 expect(batch.ruleSource).toBe('demo');expect(batch.compensationResult!.rows).toHaveLength(6);expect(batch.salaries).toHaveLength(6);
 expect(batch.salaries.every(salary=>Number.isFinite(salary.total)&&salary.total>0)).toBe(true);
 expect(batch.salaries.reduce((sum,row)=>sum+row.total,0)).toBe(batch.compensationResult!.rows.reduce((sum,row)=>sum+row.total,0));
 expect(after.compensationRules).toEqual(before.compensationRules);expect(after.publishedCompensationRules).toEqual(before.publishedCompensationRules);
 expect(after.compensationTasks).toEqual(before.compensationTasks);expect(after.dataset).toEqual(before.dataset);
 expect(after.archivedMonths).toEqual([]);expect(payrollBatchInputIssue(after,batch)).toBe('');
 expect(monthlyPayrollTasks(after)[0]).toMatchObject({status:'待复核',employees:6});
 expect(monthlyPayrollTasks(after)[0].rules!.every(rule=>rule.name.startsWith('模拟 ·'))).toBe(true);
 expect(buildReviewedPayrollWorkbook(batch).SheetNames).toContain('模拟核算说明');
});

it('keeps mock results editable and applies detail totals to the summary, including after reload',()=>{
 const s=useHub.getState();s.runDemoPayroll();
 const batch=useHub.getState().batch!,row=batch.compensationResult!.rows[0],key=payrollDetailKey(row);
 s.addPayrollColumn(batch.month,{id:'memo',label:'复核备注',type:'text'},0);
 s.savePayrollDetail(batch.month,key,{'result.total':1234,memo:'演示修订'},'汇报演示',1);
 expect(useHub.getState().batch!.salaries.find(item=>item.employeeId===row.employeeId)!.total).not.toBe(1234);
 s.applyPayrollEdits(batch.month,2);
 expect(useHub.getState().batch!.salaries.find(item=>item.employeeId===row.employeeId)!.total).toBe(1234);
 const options=useHub.persist.getOptions(),saved=JSON.parse(JSON.stringify(options.partialize!(useHub.getState())));
 const restored=options.merge!(saved,useHub.getInitialState());
 expect(restored.batch).toEqual(useHub.getState().batch);expect(payrollBatchInputIssue(restored,restored.batch!)).toBe('');
 expect(()=>s.runDemoPayroll()).toThrow(/版本/);
 s.runDemoPayroll(useHub.getState().batch!.review!.version);
 expect(useHub.getState().batch!.review!.columns).toEqual([]);
});

it('requires permission and a due task, and never overwrites archived results',()=>{
 const s=useHub.getState();useHub.setState({session:null});expect(()=>s.runDemoPayroll()).toThrow(/权限/);
 useHub.setState({session:{kind:'admin',username:'admin',method:'password'},monthlyPayrollJobs:[]});
 expect(()=>s.runDemoPayroll()).toThrow(/任务/);
 s.ensureMonthlyPayrollJobs(new Date('2026-10-01T00:00:00+08:00'));s.runDemoPayroll();
 s.archivePayroll('2026-09',0);
 const frozen=structuredClone(useHub.getState().batch);
 expect(()=>s.runDemoPayroll(0)).toThrow(/归档/);expect(useHub.getState().batch).toEqual(frozen);
});

it('uses simulation-only defaults for missing or invalid manual fields and leaves sources unchanged',()=>{
 const s=useHub.getState(),row={...s.dataset.rows.find(row=>row.roles.includes('主播'))!,waitingSalaryDays:NaN,adCost:-1,earlyPremium:undefined};
 const source=structuredClone(row);
 const {result}=calculateDemoPayroll([row],s.employees,s.departments,s.rooms,s.month);
 expect(result.salaries[0].total).toBeGreaterThan(0);
 expect(row).toEqual(source);expect(result.rows[0].statistics!.waitingSalaryDays).toBe(0);
});

it('can replace a demo with a normal calculation without changing the regular rule requirements',()=>{
 const s=useHub.getState();s.runDemoPayroll();
 expect(()=>s.runPayroll(0)).toThrow(/已发布/);
 s.saveCompensationRule({id:'real-night',name:'已配置夜班补贴',version:1,status:'草稿',scope:'global',roomIds:[],type:'allowance',allowance:{field:'nightSessions',amount:30}});
 s.publishCompensationRule('real-night');s.runPayroll(0);
 const batch=useHub.getState().batch!;
 expect(batch.ruleSource).toBe('published-rules');expect(batch.snapshot.compensationTasks).toHaveLength(1);
 expect(batch.compensationResult!.rows.every(row=>row.total===row.statistics!.nightSessions*30)).toBe(true);
});
