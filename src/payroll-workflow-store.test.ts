import { scheduleTestMonth } from './payroll-test-fixtures';
import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import type { CompensationRule } from './compensation-rules';
import { payrollDetailKey, payrollDetailValues } from './payroll-review';

const admin = {kind:'admin' as const,username:'admin',method:'password' as const};
const allowance = (id='review-allowance'):CompensationRule => ({id,name:id,scope:'global',roomIds:[],type:'allowance',version:1,status:'草稿',allowance:{field:'nightSessions',amount:20}});
beforeEach(()=>{useHub.getState().reset();useHub.setState({session:admin,compensationRules:[],compensationTasks:[],payrollTasks:[]});});
beforeEach(scheduleTestMonth);
const calculate=()=>{scheduleTestMonth();const s=useHub.getState();s.saveCompensationRule(allowance());s.publishCompensationRule('review-allowance',s.month);s.runPayroll();return useHub.getState().batch!;};

it('calculation stays open until an authorized person explicitly archives the reviewed result',()=>{
 const batch=calculate();expect(useHub.getState().archivedMonths).toEqual([]);expect(batch.review?.version).toBe(0);
 useHub.setState({session:null});expect(()=>useHub.getState().archivePayroll(batch.month,0)).toThrow(/权限/);
 useHub.setState({session:admin});useHub.getState().archivePayroll(batch.month,0);
 const archived=useHub.getState().batch!;expect(archived.status).toBe('已锁定');expect(archived.archivedBy).toBe('admin');expect(archived.archivedAt).toBeTruthy();
 expect(useHub.getState().archivedMonths).toEqual([batch.month]);expect(()=>useHub.getState().runPayroll()).toThrow(/归档/);
});

it('stale sources or changed publication membership prevent archival without partial writes',()=>{
 const batch=calculate(),s=useHub.getState();s.saveEmployee({...s.employees[0],phone:'new phone'});
 expect(()=>useHub.getState().archivePayroll(batch.month,0)).toThrow(/来源|重新/);expect(useHub.getState().archivedMonths).toEqual([]);
 useHub.getState().reset();useHub.setState({session:admin,compensationRules:[],compensationTasks:[],payrollTasks:[]});calculate();
 const current=useHub.getState();current.saveCompensationRule(allowance('extra'));current.publishCompensationRule('extra',current.month);
 expect(()=>useHub.getState().archivePayroll(current.month,0)).toThrow(/任务|规则|重新/);expect(useHub.getState().archivedMonths).toEqual([]);
});

it('republishing replaces available rules but preserves results until HR recalculates',()=>{
 const batch=calculate(),s=useHub.getState(),task=s.compensationTasks[0];
 expect(()=>s.withdrawCompensationTask(task.id)).toThrow(/按月|自动|单独/);
 s.saveCompensationRule({...allowance(),allowance:{field:'nightSessions',amount:30}});s.publishCompensationRule(task.ruleId);
 expect(useHub.getState().batch).toEqual(batch);
 expect(()=>useHub.getState().archivePayroll(batch.month,0)).toThrow(/规则|重新/);
 s.runPayroll(batch.review!.version);expect(useHub.getState().compensationTasks.map(item=>[item.status,item.ruleVersion])).toEqual([['已核算',2]]);
});

it('browsing another month preserves the published dataset version and computed review',()=>{
 const batch=calculate(),s=useHub.getState(),version=s.dataset.version;s.setMonth('2026-11');s.setMonth(batch.month);
 expect(useHub.getState().dataset.version).toBe(version);expect(useHub.getState().batch).toEqual(batch);
 useHub.getState().archivePayroll(batch.month,0);expect(useHub.getState().archivedMonths).toEqual([batch.month]);
});

it('detail editing never recalculates other cells or summary; only explicit apply changes the summary',()=>{
 const batch=calculate(),row=batch.compensationResult!.rows[0],key=payrollDetailKey(row),original=structuredClone(batch);
 useHub.getState().addPayrollColumn(batch.month,{id:'reviewNote',label:'复核备注',type:'text'},0);
 useHub.getState().savePayrollDetail(batch.month,key,{spend:888,'result.total':321,reviewNote:'核对后调整'},'人工复核',1);
 const edited=useHub.getState().batch!;
 expect(edited.compensationResult).toEqual(original.compensationResult);expect(edited.snapshot).toEqual(original.snapshot);expect(edited.salaries).toEqual(original.salaries);
 expect(payrollDetailValues(edited,row)).toMatchObject({spend:888,'result.total':321,reviewNote:'核对后调整',roi:payrollDetailValues(original,row).roi});
 expect(()=>useHub.getState().archivePayroll(batch.month,2)).toThrow(/应用/);
 useHub.getState().applyPayrollEdits(batch.month,2);
 const applied=useHub.getState().batch!,oldTotal=original.salaries.find(salary=>salary.employeeId===row.employeeId)!.total;
 expect(applied.salaries.find(salary=>salary.employeeId===row.employeeId)!.total).toBeCloseTo(oldTotal-row.total+321);
 expect(applied.review).toMatchObject({dirty:false,version:3});expect(applied.compensationResult).toEqual(original.compensationResult);expect(applied.snapshot).toEqual(original.snapshot);
 useHub.getState().archivePayroll(batch.month,3);
 expect(()=>useHub.getState().savePayrollDetail(batch.month,key,{'result.total':100},'late',3)).toThrow(/归档/);
 expect(()=>useHub.getState().applyPayrollEdits(batch.month,3)).toThrow(/归档/);
});

it('all result mutations require permissions and a current review version',()=>{
 const batch=calculate(),key=payrollDetailKey(batch.compensationResult!.rows[0]);
 useHub.setState({session:null});
 expect(()=>useHub.getState().savePayrollDetail(batch.month,key,{'result.total':100},'review',0)).toThrow(/权限/);
 expect(()=>useHub.getState().addPayrollColumn(batch.month,{id:'note',label:'备注',type:'text'},0)).toThrow(/权限/);
 expect(()=>useHub.getState().deletePayrollColumn(batch.month,'note',0)).toThrow(/权限/);
 expect(()=>useHub.getState().applyPayrollEdits(batch.month,0)).toThrow(/权限/);
 expect(()=>useHub.getState().lockBatch()).toThrow(/权限/);
 useHub.setState({session:admin});useHub.getState().addPayrollColumn(batch.month,{id:'note',label:'备注',type:'text'},0);
 const before=structuredClone(useHub.getState().batch);
 expect(()=>useHub.getState().savePayrollDetail(batch.month,key,{'result.total':100},'review',0)).toThrow(/版本/);
 expect(()=>useHub.getState().addPayrollColumn(batch.month,{id:'note2',label:'备注2',type:'text'},0)).toThrow(/版本/);
 expect(()=>useHub.getState().deletePayrollColumn(batch.month,'note',0)).toThrow(/版本/);
 expect(()=>useHub.getState().applyPayrollEdits(batch.month,0)).toThrow(/版本/);
 expect(()=>useHub.getState().archivePayroll(batch.month,0)).toThrow(/版本/);
 expect(useHub.getState().batch).toEqual(before);
});

it('persists custom-header deletion and requires apply before archival, then locks deletion',()=>{
 const batch=calculate(),s=useHub.getState();
 s.addPayrollColumn(batch.month,{id:'note',label:'备注',type:'text'},0);
 s.addPayrollColumn(batch.month,{id:'keep',label:'补充',type:'text'},1);
 s.applyPayrollEdits(batch.month,2);s.deletePayrollColumn(batch.month,'note',3);
 expect(()=>s.archivePayroll(batch.month,4)).toThrow(/应用/);
 const options=useHub.persist.getOptions(),saved=JSON.parse(JSON.stringify(options.partialize!(useHub.getState())));
 const restored=options.merge!(saved,useHub.getInitialState());
 expect(restored.batch!.review!.columns.map(column=>column.id)).toEqual(['keep']);
 expect(restored.batch!.review!.dirty).toBe(true);
 s.applyPayrollEdits(batch.month,4);s.archivePayroll(batch.month,5);
 const frozen=structuredClone(useHub.getState().batch);
 expect(()=>s.deletePayrollColumn(batch.month,'keep',5)).toThrow(/归档/);
 expect(useHub.getState().batch).toEqual(frozen);
});

it('HR can archive while salary operators can only review and apply',()=>{
 const batch=calculate(),s=useHub.getState(),operator=s.employees[0];
 useHub.setState({employees:s.employees.map(employee=>employee.id===operator.id?{...employee,role:'salary'}:employee),session:{kind:'employee',username:operator.id,employeeId:operator.id,method:'password'}});
 useHub.getState().addPayrollColumn(batch.month,{id:'note',label:'复核备注',type:'text'},0);useHub.getState().applyPayrollEdits(batch.month,1);
 expect(()=>useHub.getState().archivePayroll(batch.month,2)).toThrow(/归档权限/);
 useHub.setState({employees:useHub.getState().employees.map(employee=>employee.id===operator.id?{...employee,role:'hr'}:employee)});
 useHub.getState().archivePayroll(batch.month,2);expect(useHub.getState().batch!.archivedBy).toBe(operator.id);
});

it('switching months before calculation preserves publication versions',()=>{
 const s=useHub.getState();s.saveCompensationRule(allowance());s.publishCompensationRule('review-allowance',s.month);
 const month=s.month,version=s.dataset.version;s.setMonth('2026-11');s.setMonth(month);
 expect(useHub.getState().dataset.version).toBe(version);expect(()=>useHub.getState().runPayroll()).not.toThrow();
});

it('rehydration normalizes only current employee rules and migrates untouched built-in permissions',()=>{
 const batch=calculate(),current=useHub.getState(),options=useHub.persist.getOptions(),old={...allowance('old'),scope:'employees' as const,version:3,status:'已发布' as const,employeeCondition:{kind:'group' as const,operator:'and' as const,children:[]}};
 const snapshot=structuredClone(batch),restored=options.merge!({compensationRules:[old],batches:{[batch.month]:snapshot},batch:snapshot,roles:[{id:'hr',name:'HR',description:'',permissions:['员工管理','部门管理','身份绑定']},{id:'salary',name:'薪酬核算',description:'',permissions:['薪酬规则','薪酬核算','工资发布','工资导出']},{id:'custom',name:'自定义',description:'',permissions:[]}]},current);
 expect(restored.compensationRules[0]).toMatchObject({scope:'global',status:'草稿',version:4});expect(restored.compensationRules[0].employeeCondition).toBeUndefined();
 expect(restored.batch).toEqual(snapshot);expect(restored.batches[batch.month]).toEqual(snapshot);expect(restored.roles[0].permissions).toContain('薪酬归档');expect(restored.roles[1].permissions).not.toContain('薪酬归档');expect(restored.roles[2].permissions).toEqual([]);
 expect(options.merge!({compensationRules:restored.compensationRules},restored).compensationRules[0].version).toBe(4);
});

it('legacy completed room sets still withdraw all sibling types together',()=>{
 const s=useHub.getState(),roomIds=[s.rooms[0].id],setId='review-room-set';
 const rules:CompensationRule[]=[{...allowance('room-allowance'),scope:'rooms',roomIds},{id:'room-hourly',name:'时薪',scope:'rooms',roomIds,type:'hourly',version:1,status:'草稿',hourly:{duration:'hours',items:[{id:'rate',name:'时段时薪',kind:'special',rate:10}],formula:{mode:'additions',itemIds:['rate']}}}];
 s.saveRoomRuleSet({id:setId,roomIds,rules});s.publishRoomRuleSet(setId,s.month);s.runPayroll();
 const legacyBatch={...useHub.getState().batch!,ruleSource:undefined};useHub.setState({monthlyPayrollJobs:[],batch:legacyBatch,batches:{[s.month]:legacyBatch}});
 const batch=structuredClone(useHub.getState().batch);s.withdrawCompensationTask(useHub.getState().compensationTasks[0].id);
 expect(useHub.getState().compensationTasks.map(task=>task.status)).toEqual(['已撤回','已撤回']);expect(useHub.getState().batch).toEqual(batch);
 expect(()=>s.archivePayroll(s.month,0)).toThrow(/任务|重新/);
});

it('wage-slip publication requires both archival and explicit publishing permission',()=>{
 const batch=calculate();expect(()=>useHub.getState().publishBatch()).toThrow(/归档/);
 useHub.getState().archivePayroll(batch.month,0);useHub.setState({session:null});expect(()=>useHub.getState().publishBatch()).toThrow(/权限/);
 const s=useHub.getState(),operator=s.employees[0];useHub.setState({employees:s.employees.map(employee=>employee.id===operator.id?{...employee,role:'hr'}:employee),session:{kind:'employee',username:operator.id,employeeId:operator.id,method:'password'}});
 expect(()=>useHub.getState().publishBatch()).toThrow(/工资发布权限/);
 useHub.setState({session:admin});useHub.getState().publishBatch();expect(useHub.getState().batch!.status).toBe('已发布');
});

it('anonymous calculation cannot create or replace a monthly result',()=>{
 const s=useHub.getState();s.saveCompensationRule(allowance());s.publishCompensationRule('review-allowance',s.month);useHub.setState({session:null});
 expect(()=>useHub.getState().runPayroll()).toThrow(/权限/);expect(useHub.getState().batch).toBeNull();
 useHub.setState({session:admin});useHub.getState().runPayroll();const before=structuredClone(useHub.getState().batch);useHub.setState({session:null});
 expect(()=>useHub.getState().runPayroll(0)).toThrow(/权限/);expect(useHub.getState().batch).toEqual(before);
});

it('recalculation requires the confirmed review version and advances it so stale editors cannot overwrite new results',()=>{
 const batch=calculate(),key=payrollDetailKey(batch.compensationResult!.rows[0]);
 useHub.getState().savePayrollDetail(batch.month,key,{'result.total':123},'待复核修订',0);
 const edited=structuredClone(useHub.getState().batch);
 expect(()=>useHub.getState().runPayroll()).toThrow(/版本/);
 expect(()=>useHub.getState().runPayroll(0)).toThrow(/版本/);expect(useHub.getState().batch).toEqual(edited);
 useHub.getState().runPayroll(1);
 expect(useHub.getState().batch!.review).toMatchObject({version:2,dirty:false,draftCells:{},columns:[]});
 expect(()=>useHub.getState().savePayrollDetail(batch.month,key,{'result.total':999},'旧窗口',0)).toThrow(/版本/);
 expect(()=>useHub.getState().archivePayroll(batch.month,0)).toThrow(/版本/);
 expect(()=>useHub.getState().runPayroll(1)).toThrow(/版本/);
 useHub.getState().archivePayroll(batch.month,2);
});
