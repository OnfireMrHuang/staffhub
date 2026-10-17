import { scheduleTestMonth } from './payroll-test-fixtures';
import { expect, it } from 'vitest';
import { monthlyPayrollTasks, payrollCalculationConfirmation } from './payroll-task-view';
import { useHub, type Batch, type CompensationTask } from './store';
import { createPayrollReview } from './payroll-review';

it('groups all published calculation types by month and preserves withdrawn-only months',()=>{
 const base=useHub.getInitialState(), rule=base.compensationRules[0];
 const task:CompensationTask={id:'a',month:base.month,ruleId:rule.id,ruleName:rule.name,ruleVersion:1,scope:rule.scope,type:rule.type,rule,datasetVersion:base.dataset.version,datasetRevision:base.revision,referenceDate:`${base.month}-30`,employeeIds:['E1'],rowKeys:['R1'],status:'待核算',created:'2026-10-01'};
 const groups=monthlyPayrollTasks({...base,batch:null,batches:{},archivedMonths:[],payrollTasks:[],compensationTasks:[task,{...task,id:'b',employeeIds:['E1','E2']},{...task,id:'c',month:'2026-08',status:'已撤回'}]});
 expect(groups).toHaveLength(2);
 expect(groups[0]).toMatchObject({month:base.month,status:'待核算',employees:6});
 expect(groups[0].tasks).toHaveLength(2);
 expect(groups[1]).toMatchObject({month:'2026-08',status:'已撤回',employees:0});
});
it('uses live inputs before archive and frozen task inputs after archive',()=>{
 const base=useHub.getInitialState(),rule=base.compensationRules[0];
 const task:CompensationTask={id:'original',month:base.month,ruleId:rule.id,ruleName:rule.name,ruleVersion:1,scope:rule.scope,type:rule.type,rule,datasetVersion:base.dataset.version,datasetRevision:base.revision,referenceDate:`${base.month}-30`,employeeIds:['E1'],rowKeys:['R1'],status:'已核算',created:'2026-10-01'};
 const batch:Batch={month:base.month,status:'已核算',salaries:[],datasetVersion:base.dataset.version,ruleVersion:1,created:'2026-10-02',logs:[],review:createPayrollReview(),snapshot:{records:[],adHours:[],roomHours:[],employees:[],departments:[],products:[],rooms:[],details:[],monthly:[],dataset:{...base.dataset,published:true},departmentRules:[],payrollTasks:[],compensationTasks:[task]}};
 const state={...base,dataset:{...base.dataset,published:true},batch,batches:{[batch.month]:batch},archivedMonths:[],payrollTasks:[],compensationTasks:[task]};
 expect(monthlyPayrollTasks(state)[0].status).toBe('待复核');
 expect(monthlyPayrollTasks({...state,batch:{...batch,review:{...batch.review!,dirty:true}}})[0].status).toBe('待应用');
 const replaced={...state,compensationTasks:[{...task,id:'replacement',status:'待核算' as const}]};
 expect(monthlyPayrollTasks(replaced)[0]).toMatchObject({status:'待重新核算',tasks:[{id:'replacement'}]});
 expect(monthlyPayrollTasks({...replaced,archivedMonths:[batch.month]})[0]).toMatchObject({status:'已归档',tasks:[{id:'original'}]});
});

it('previews all eligible monthly hosts for a room-only rule, matching the calculation result',()=>{
 const before=useHub.getState();
 try{
  const base=useHub.getInitialState(),room=base.rooms[0];
  useHub.setState({...base,session:{kind:'admin',username:'admin',method:'password'},compensationRules:[],compensationTasks:[],payrollTasks:[],batch:null,batches:{},archivedMonths:[]},true);
  scheduleTestMonth();
  useHub.getState().cleanDataset();
  useHub.getState().saveCompensationRule({id:'preview-room-allowance',name:'直播间补贴预览',version:1,status:'草稿',scope:'rooms',roomIds:[room.id],type:'allowance',allowance:{field:'nightSessions',amount:30}});
  useHub.getState().publishCompensationRule('preview-room-allowance',base.month);
  const state=useHub.getState(), preview=monthlyPayrollTasks(state)[0];
  expect(state.compensationTasks).toEqual([]);
  expect(preview.employees).toBe(6);
  const initialConfirmation=payrollCalculationConfirmation(preview.batch);
  state.runPayroll(initialConfirmation.version);
  expect(useHub.getState().compensationTasks[0].employeeIds.length).toBeLessThan(6);
  expect(useHub.getState().batch!.salaries).toHaveLength(preview.employees);
  expect(()=>useHub.getState().runPayroll(initialConfirmation.version)).toThrow('重新确认核算');
  const recalculateConfirmation=payrollCalculationConfirmation(useHub.getState().batch!);
  useHub.getState().runPayroll(recalculateConfirmation.version);
  expect(useHub.getState().batch!.review!.version).toBe(1);
  expect(()=>useHub.getState().runPayroll(recalculateConfirmation.version)).toThrow('重新确认核算');
 }finally{useHub.setState(before,true)}
});
