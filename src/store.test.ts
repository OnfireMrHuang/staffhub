import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import { eligibleEmployeeIds } from './seed';
beforeEach(()=>useHub.getState().reset());
it('来源改动后旧数据集不能核算，重新清洗后可核算',()=>{
 const s=useHub.getState(); s.saveFacts([{...s.facts[0],id:'correction',version:2,amount:120000}]);
 expect(()=>useHub.getState().runPayroll()).toThrow('重新清洗');
 useHub.getState().cleanDataset(); useHub.getState().runPayroll();
 expect(useHub.getState().batch?.salaries).toHaveLength(eligibleEmployeeIds.length);
});
it('锁定并发布的工资保留快照，员工和源记录改动不重写工资',()=>{
 useHub.getState().runPayroll(); useHub.getState().lockBatch(); useHub.getState().publishBatch();
 const before=structuredClone(useHub.getState().batch);
 useHub.getState().saveEmployee({...useHub.getState().employees[0],name:'修改后姓名'});
 expect(useHub.getState().batch).toEqual(before);
 expect(()=>useHub.getState().runPayroll()).toThrow('已锁定');
});
it('工资只有锁定后可发布',()=>{useHub.getState().runPayroll();expect(()=>useHub.getState().publishBatch()).toThrow('锁定');});
it('跨月核算保留已发布的历史工资并可切回查看',()=>{
 useHub.getState().runPayroll();useHub.getState().lockBatch();useHub.getState().publishBatch();const september=structuredClone(useHub.getState().batch);
 const october=useHub.getState().facts.map(f=>({...f,id:`oct-${f.id}`,key:`oct-${f.key}`,month:'2026-10'}));
 useHub.getState().setMonth('2026-10');useHub.getState().saveFacts(october);useHub.getState().cleanDataset();useHub.getState().runPayroll();
 expect(useHub.getState().batches['2026-09']).toEqual(september);useHub.getState().setMonth('2026-09');expect(useHub.getState().batch).toEqual(september);
});
