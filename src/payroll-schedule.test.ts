import { beforeEach, expect, it } from 'vitest';
import { useHub, payrollBatchInputIssue } from './store';
import { monthlyPayrollTasks } from './payroll-task-view';
import type { CompensationRule } from './compensation-rules';

const rule=(amount=20):CompensationRule=>({id:'scheduled-allowance',name:'月度补贴',version:1,status:'草稿',scope:'global',roomIds:[],type:'allowance',allowance:{field:'nightSessions',amount}});
const due=new Date('2026-11-01T00:00:00+08:00');
beforeEach(()=>{useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'},compensationRules:[]});});
const publish=(amount=20)=>{useHub.getState().saveCompensationRule(rule(amount));useHub.getState().publishCompensationRule(rule().id);};

it('publication stores a reusable definition without creating a monthly job or calculation input',()=>{
 const s=useHub.getState();useHub.setState({dataset:{...s.dataset,published:false,rows:[]},revision:100});
 publish();
 expect(useHub.getState().publishedCompensationRules[0]).toMatchObject({id:rule().id,status:'已发布'});
 expect(useHub.getState().monthlyPayrollJobs).toEqual([]);
 expect(useHub.getState().compensationTasks).toEqual([]);
 expect(monthlyPayrollTasks(useHub.getState())).toEqual([]);
 expect(useHub.getState().batch).toBeNull();
});
it('creates one prior-month job at the Shanghai month boundary even without rules or data',()=>{
 useHub.getState().ensureMonthlyPayrollJobs(new Date('2026-10-31T15:59:59Z'));
 expect(useHub.getState().monthlyPayrollJobs.map(job=>job.month)).toEqual(['2026-09']);
 useHub.getState().ensureMonthlyPayrollJobs(new Date('2026-10-31T16:00:00Z'));
 expect(useHub.getState().monthlyPayrollJobs.map(job=>job.month)).toEqual(['2026-09','2026-10']);
 expect(monthlyPayrollTasks(useHub.getState())[0]).toMatchObject({month:'2026-10',status:'待核算',tasks:[]});
 expect(useHub.getState().batch).toBeNull();expect(useHub.getState().compensationTasks).toEqual([]);
});
it('backfills missed months once and preserves existing jobs after repeated checks and rehydration',()=>{
 const s=useHub.getState();s.ensureMonthlyPayrollJobs(new Date('2026-12-01T00:00:00+08:00'));
 const initial=structuredClone(useHub.getState().monthlyPayrollJobs[0]);
 s.ensureMonthlyPayrollJobs(new Date('2027-02-15T12:00:00+08:00'));
 s.ensureMonthlyPayrollJobs(new Date('2027-02-28T23:59:59+08:00'));
 const jobs=useHub.getState().monthlyPayrollJobs;
 expect(jobs.map(job=>job.month)).toEqual(['2026-11','2026-12','2027-01']);expect(jobs[0]).toEqual(initial);
 const options=useHub.persist.getOptions(),saved=JSON.parse(JSON.stringify(options.partialize!(useHub.getState())));
 const restored=options.merge!(saved,useHub.getInitialState());useHub.setState(restored,true);restored.ensureMonthlyPayrollJobs(new Date('2027-02-28T23:59:59+08:00'));
 expect(useHub.getState().monthlyPayrollJobs).toEqual(jobs);
});
it('does not create a duplicate job for a previously archived month',()=>{
 useHub.setState({archivedMonths:['2026-10']});useHub.getState().ensureMonthlyPayrollJobs(due);
 expect(useHub.getState().monthlyPayrollJobs).toEqual([]);
});
it('waits for an explicit authorized calculation and uses the latest published rules and data',()=>{
 useHub.getState().ensureMonthlyPayrollJobs(due);publish(20);
 const job=structuredClone(useHub.getState().monthlyPayrollJobs[0]);
 publish(30);const before=useHub.getState();
 useHub.setState({dataset:{...before.dataset,version:2,rows:before.dataset.rows.map(row=>({...row,nightSessions:3}))}});
 expect(useHub.getState().compensationTasks).toEqual([]);
 useHub.setState({session:null});expect(()=>useHub.getState().runPayroll()).toThrow(/权限/);
 useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});useHub.getState().runPayroll();
 const s=useHub.getState();expect(s.batch!.compensationResult!.rows.every(row=>row.total===90)).toBe(true);
 expect(s.monthlyPayrollJobs).toEqual([job]);expect(s.archivedMonths).toEqual([]);
 expect(s.batch!.snapshot.compensationTasks![0]).toMatchObject({ruleVersion:2,datasetVersion:2,status:'已核算'});
 expect(monthlyPayrollTasks(s)[0].status).toBe('待复核');
});
it('keeps published versions while editing drafts and requires recalculation only after republication',()=>{
 useHub.getState().ensureMonthlyPayrollJobs(due);publish();useHub.getState().runPayroll();
 const batch=structuredClone(useHub.getState().batch!);useHub.getState().saveCompensationRule(rule(99));
 expect(payrollBatchInputIssue(useHub.getState(),batch)).toBe('');
 useHub.getState().publishCompensationRule(rule().id);
 expect(payrollBatchInputIssue(useHub.getState(),batch)).toMatch(/规则/);
 expect(()=>useHub.getState().archivePayroll(batch.month,0)).toThrow(/规则/);
 expect(useHub.getState().batch).toEqual(batch);
 useHub.getState().runPayroll(0);useHub.getState().archivePayroll(batch.month,1);
 const frozen=structuredClone(useHub.getState().batch);publish(100);
 expect(useHub.getState().batch).toEqual(frozen);expect(monthlyPayrollTasks(useHub.getState())[0].status).toBe('已归档');
});
it('missing rules or missing confirmed data leave the job pending without partial results',()=>{
 useHub.getState().ensureMonthlyPayrollJobs(due);expect(()=>useHub.getState().runPayroll()).toThrow(/已发布.*规则/);
 publish();const s=useHub.getState();useHub.setState({dataset:{...s.dataset,published:false}});
 expect(()=>useHub.getState().runPayroll()).toThrow(/刷新/);
 expect(useHub.getState().batch).toBeNull();expect(useHub.getState().compensationTasks).toEqual([]);
 expect(monthlyPayrollTasks(useHub.getState())[0].status).toBe('待核算');
});
it('publishing cannot make the not-yet-due current month calculable',()=>{
 publish();expect(()=>useHub.getState().runPayroll()).toThrow(/任务/);expect(useHub.getState().monthlyPayrollJobs).toEqual([]);
});
