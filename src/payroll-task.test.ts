import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import type { DepartmentRule } from './payroll-rules';

beforeEach(()=>useHub.getState().reset());
const rule = (id='task-rule', rate=50):DepartmentRule => ({id,name:id,departmentId:'live',version:1,status:'草稿',metrics:[{id:'hours',field:'hours',rate,bands:[]}],expression:['hours'],roomIds:[useHub.getState().rooms[0].id]});
const publish = (value=rule()) => { useHub.getState().saveDepartmentRule(value);useHub.getState().publishDepartmentRule(value.id,useHub.getState().month); };

it('迁移六条规则为草稿，前三条绑定示例直播间且没有任务',()=>{
 const s=useHub.getState();expect(s.departmentRules).toHaveLength(6);expect(s.departmentRules.every(r=>r.status==='草稿')).toBe(true);
 expect(s.departmentRules.slice(0,3).every(r=>r.roomIds.length===1)).toBe(true);expect(s.payrollTasks).toEqual([]);
 expect(()=>s.runPayroll()).toThrow('任务');
});
it('保存仅递增当前规则版本，发布后编辑不改变快照或确认名单',()=>{
 const s=useHub.getState(),otherVersion=s.departmentRules[0].version;
 publish();const task=structuredClone(useHub.getState().payrollTasks[0]);
 expect(task.ruleVersion).toBe(1);expect(task.rule.status).toBe('已发布');expect(task.employeeIds.length).toBeGreaterThan(0);
 useHub.getState().saveDepartmentRule({...rule(),metrics:[{id:'hours',field:'hours',rate:100,bands:[]}]});
 expect(useHub.getState().departmentRules.find(r=>r.id==='task-rule')?.version).toBe(2);
 expect(useHub.getState().departmentRules.find(r=>r.id==='task-rule')?.status).toBe('草稿');
 expect(useHub.getState().departmentRules[0].version).toBe(otherVersion);expect(useHub.getState().payrollTasks[0]).toEqual(task);
 useHub.getState().runPayroll();
 const salary=useHub.getState().batch!.salaries.find(e=>e.employeeId===task.employeeIds[0])!;
 expect(salary.total).toBe(salary.details[0].hours*50);
});
it('发布校验重复、月份、数据集新鲜度、活动部门与直播间',()=>{
 publish();expect(()=>useHub.getState().publishDepartmentRule('task-rule','2026-10')).toThrow('重复');
 expect(()=>useHub.getState().publishDepartmentRule('task-rule','2026-11')).toThrow('月份');
 useHub.getState().saveEmployee({...useHub.getState().employees[0],name:'新姓名'});
 expect(()=>useHub.getState().publishDepartmentRule(useHub.getState().departmentRules[0].id,'2026-10')).toThrow('重新');
 useHub.getState().cleanDataset();useHub.setState({rooms:useHub.getState().rooms.map((p,i)=>i? p:{...p,active:false})});
 expect(()=>useHub.getState().publishDepartmentRule(useHub.getState().departmentRules[0].id,'2026-10')).toThrow('直播间');
 useHub.setState({rooms:useHub.getState().rooms.map(p=>({...p,active:true})),departments:useHub.getState().departments.map(d=>({...d,active:false}))});
 expect(()=>useHub.getState().publishDepartmentRule(useHub.getState().departmentRules[0].id,'2026-10')).toThrow('部门');
});
it('未绑定直播间的迁移草稿不可发布，新增无直播间规则不能保存',()=>{
 expect(()=>useHub.getState().publishDepartmentRule(useHub.getState().departmentRules[3].id,'2026-10')).toThrow('直播间');
 expect(()=>useHub.getState().saveDepartmentRule({...rule(),roomIds:[]})).toThrow('直播间');
 expect(useHub.getState().payrollTasks).toEqual([]);
});
it('发布不接收没有参与工作的部门员工，核算保留已确认名单',()=>{
 const s=useHub.getState();s.saveEmployee({...s.employees[0],id:'no-work',name:'无工作数据员工'});s.cleanDataset();publish();
 expect(useHub.getState().payrollTasks[0].employeeIds).not.toContain('no-work');
 useHub.getState().runPayroll();expect(useHub.getState().batch?.salaries.some(e=>e.employeeId==='no-work')).toBe(false);
});
it('已发布名单发生部门、在职状态或工作消失时阻止核算，不静默缩小名单',()=>{
 for(const change of ['department','status','work']) {
  useHub.getState().reset();publish();const s=useHub.getState(),id=s.payrollTasks[0].employeeIds[0];
  if(change==='work') { const rows=s.dataset.rows.filter(r=>r.employeeId!==id);useHub.setState({dataset:{...s.dataset,rows}}); }
  else {s.saveEmployee({...s.employees.find(e=>e.id===id)!,...(change==='department'?{departmentId:'ads'}:{status:'已离职' as const})});s.cleanDataset();}
  expect(()=>useHub.getState().runPayroll()).toThrow('确认');expect(useHub.getState().archivedMonths).toEqual([]);
 }
});
it('来源更正新增参与员工时拒绝核算，不能遗漏员工并归档',()=>{
 publish();const s=useHub.getState(),frozen=structuredClone(s.payrollTasks);
 const record=s.liveRecords.find(r=>r.roomId===s.payrollTasks[0].rule.roomIds[0])!;
 const newcomer=s.employees.find(e=>e.status==='在职' && e.departmentId==='live' && !s.payrollTasks[0].employeeIds.includes(e.id))!;
 s.saveLiveRecords([{...record,version:record.version+1,hostId:newcomer.id}]);s.cleanDataset();
 expect(useHub.getState().dataset.rows.some(r=>r.employeeId===record.hostId && r.roomId===record.roomId)).toBe(true);
 expect(useHub.getState().dataset.rows.some(r=>r.employeeId===newcomer.id && r.roomId===record.roomId)).toBe(true);
 expect(()=>useHub.getState().runPayroll()).toThrow('已确认任务员工名单发生变化');
 expect(useHub.getState().payrollTasks).toEqual(frozen);expect(useHub.getState().batch).toBeNull();
 expect(useHub.getState().batches).toEqual({});expect(useHub.getState().archivedMonths).toEqual([]);
});
it('保存草稿不创建任务，发布拒绝未刷新数据集和无人参与的直播间集',()=>{
 useHub.getState().saveDepartmentRule(rule());expect(useHub.getState().payrollTasks).toEqual([]);
 useHub.setState({dataset:{...useHub.getState().dataset,published:false}});
 expect(()=>useHub.getState().publishDepartmentRule('task-rule','2026-10')).toThrow('刷新');
 const s=useHub.getState();useHub.setState({dataset:{...s.dataset,published:true,rows:[]}});
 expect(()=>useHub.getState().publishDepartmentRule('task-rule','2026-10')).toThrow('参与');
 expect(useHub.getState().payrollTasks).toEqual([]);
});
it('任务记录发布时数据集版本，来源修正后记录实际核算版本',()=>{
 publish();const published=useHub.getState().payrollTasks[0];
 expect(published.datasetVersion).toBe(1);expect(published.datasetRevision).toBe(1);
 const s=useHub.getState();s.saveLiveRecords([{...s.liveRecords[0],version:2}]);s.cleanDataset();s.runPayroll();
 expect(useHub.getState().payrollTasks[0].datasetVersion).toBe(1);
 expect(useHub.getState().batch!.datasetVersion).toBe(2);
 expect(useHub.getState().batch!.logs.join('\n')).toContain('发布数据集 v1');
 expect(useHub.getState().batch!.logs.join('\n')).toContain('核算数据集 v2');
});
it('保存迁移规则保留只读来源保底，普通新规则不能注入来源优先条件',()=>{
 const original=useHub.getState().departmentRules.find(r=>r.sourceFloor && r.roomIds.length)!;
 useHub.getState().saveDepartmentRule({...original,sourceFloor:{roiBelow:999,rate:999},sourceNote:'替换来源'});
 const saved=useHub.getState().departmentRules.find(r=>r.id===original.id)!;
 expect(saved.sourceFloor).toEqual(original.sourceFloor);expect(saved.sourceNote).toBe(original.sourceNote);
 useHub.getState().saveDepartmentRule({...saved,sourceFloor:undefined});
 expect(useHub.getState().departmentRules.find(r=>r.id===original.id)!.sourceFloor).toEqual(original.sourceFloor);
 expect(()=>useHub.getState().saveDepartmentRule({...rule(),sourceFloor:{roiBelow:2,rate:999}})).toThrow('来源');
});
it('同月所有任务成功后合并每位员工的规则金额并归档完整快照',()=>{
 publish(rule('first',50));publish(rule('second',25));useHub.getState().runPayroll();
 const s=useHub.getState();expect(s.payrollTasks.every(t=>t.status==='已核算')).toBe(true);expect(s.archivedMonths).toEqual(['2026-10']);
 const salary=s.batch!.salaries.find(e=>e.employeeId===s.payrollTasks[0].employeeIds[0])!;
 expect(salary.fixed).toBe(0);expect(salary.details).toHaveLength(2);expect(salary.total).toBe(salary.details[0].hours*75);
 expect(s.batch!.snapshot.departmentRules).toEqual(s.departmentRules);expect(s.batch!.snapshot.payrollTasks).toEqual(s.payrollTasks);
 const saved=useHub.persist.getOptions().partialize!(s) as typeof s;expect(saved.payrollTasks).toEqual(s.payrollTasks);
 expect(saved.batches['2026-10'].snapshot.payrollTasks[0].rule).toEqual(s.payrollTasks[0].rule);
 expect(()=>s.publishDepartmentRule('first','2026-10')).toThrow('归档');
});
it('后续任务档位缺失时整个月不保存部分结果或任务完成状态',()=>{
 publish(rule('good'));publish({...rule('bad'),metrics:[{id:'roi',field:'roi',durationField:'hours',bands:[{keyType:'exact',exact:99,includeMin:true,includeMax:true,rate:1}]}],expression:['roi']});
 const before=structuredClone(useHub.getState().payrollTasks);
 expect(()=>useHub.getState().runPayroll()).toThrow();const s=useHub.getState();
 expect(s.batch).toBeNull();expect(s.batches).toEqual({});expect(s.archivedMonths).toEqual([]);expect(s.payrollTasks).toEqual(before);
});
it('撤回待核算任务保留历史，修正规则后重新发布仅按新版本计薪',()=>{
 publish(rule('recover',100));const original=structuredClone(useHub.getState().payrollTasks[0]);
 useHub.getState().withdrawPayrollTask(original.id);
 const withdrawn=useHub.getState().payrollTasks[0];
 expect(withdrawn.status).toBe('已撤回');expect(withdrawn.withdrawnAt).toBeTruthy();
 expect(withdrawn.rule).toEqual(original.rule);expect(withdrawn.employeeIds).toEqual(original.employeeIds);
 expect(withdrawn.datasetVersion).toBe(original.datasetVersion);expect(withdrawn.datasetRevision).toBe(original.datasetRevision);
 expect(useHub.getState().departmentRules.find(r=>r.id==='recover')!.status).toBe('草稿');
 expect(()=>useHub.getState().runPayroll()).toThrow('任务');
 expect(()=>useHub.getState().withdrawPayrollTask(original.id)).toThrow('待核算');
 useHub.getState().saveDepartmentRule(rule('recover',25));useHub.getState().publishDepartmentRule('recover','2026-10');
 const replacement=useHub.getState().payrollTasks[1];expect(replacement.id).not.toBe(original.id);expect(replacement.ruleVersion).toBe(2);
 useHub.getState().runPayroll();const s=useHub.getState(),salary=s.batch!.salaries[0];
 expect(salary.details).toHaveLength(1);expect(salary.total).toBe(salary.details[0].hours*25);
 expect(s.payrollTasks.map(t=>t.status)).toEqual(['已撤回','已核算']);
 expect(s.batch!.snapshot.payrollTasks).toEqual(s.payrollTasks);
 expect(s.batch!.logs.join('\n')).toContain('1 个已发布部门规则任务');
 expect(()=>s.withdrawPayrollTask(replacement.id)).toThrow('归档');expect(()=>s.withdrawPayrollTask(original.id)).toThrow('归档');
});
it('撤回旧版本任务不能覆盖已修改的新版本规则',()=>{
 publish(rule('edited',100));const taskId=useHub.getState().payrollTasks[0].id;
 useHub.getState().saveDepartmentRule(rule('edited',25));const edited=structuredClone(useHub.getState().departmentRules.find(r=>r.id==='edited'));
 useHub.getState().withdrawPayrollTask(taskId);expect(useHub.getState().departmentRules.find(r=>r.id==='edited')).toEqual(edited);
});
it('其他月份仍有同版本活动任务时撤回不改变当前规则发布状态',()=>{
 publish();const s=useHub.getState(),octoberTask=s.payrollTasks[0];
 s.saveLiveRecords([{...s.liveRecords[0],id:'withdraw-nov',date:'2026-11-01'}]);s.setMonth('2026-11');s.sync();s.cleanDataset();s.publishDepartmentRule('task-rule','2026-11');
 s.withdrawPayrollTask(octoberTask.id);expect(useHub.getState().departmentRules.find(r=>r.id==='task-rule')!.status).toBe('已发布');
 expect(useHub.getState().payrollTasks.map(t=>t.status)).toEqual(['已撤回','待核算']);
});
it('多任务金额汇总溢出时不保存无穷工资或归档',()=>{
 publish(rule('huge-first',5e304));publish(rule('huge-second',5e304));
 expect(()=>useHub.getState().runPayroll()).toThrow('汇总');
 const s=useHub.getState();expect(s.batch).toBeNull();expect(s.batches).toEqual({});expect(s.archivedMonths).toEqual([]);
 expect(s.payrollTasks.every(t=>t.status==='待核算')).toBe(true);
});
