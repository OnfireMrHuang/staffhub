import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
beforeEach(()=>{useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});});
const publishSeedRules = () => useHub.getState().departmentRules.slice(0,3).forEach(rule=>useHub.getState().publishDepartmentRule(rule.id,useHub.getState().month));
it('默认10月两表来自直播记录与模拟小时数据',()=>{
 const s=useHub.getState();
 expect(s.month).toBe('2026-10');expect(s.liveRecords.length).toBeGreaterThan(0);expect(s.roomHours.length).toBeGreaterThan(0);
 expect(s.dataset.rows).toEqual(s.monthlyRows);expect(s.liveDetails.length).toBeGreaterThan(0);
});
it('来源改动后旧数据集不能核算，重新统计后可核算',()=>{
 const s=useHub.getState();s.saveLiveRecords([{...s.liveRecords[0],version:2}]);
 expect(()=>useHub.getState().runPayroll()).toThrow('重新');
 useHub.getState().cleanDataset();publishSeedRules();useHub.getState().runPayroll();
 expect(useHub.getState().batch?.salaries.length).toBeGreaterThan(0);
});
it('工资只有手动归档后可发布',()=>{
 publishSeedRules();useHub.getState().runPayroll();expect(()=>useHub.getState().publishBatch()).toThrow('归档');
});
it('每个默认产品及直播间均能原样保存配置',()=>{
 const products=structuredClone(useHub.getState().products),rooms=structuredClone(useHub.getState().rooms);
 for(const product of products) expect(()=>useHub.getState().saveProduct(product)).not.toThrow();
 for(const room of rooms) expect(()=>useHub.getState().saveRoom(room)).not.toThrow();
 expect(useHub.getState().products).toEqual(products);expect(useHub.getState().rooms).toEqual(rooms);
});
