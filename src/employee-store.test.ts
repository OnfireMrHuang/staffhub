import { afterEach, beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
const storage=useHub.persist.getOptions().storage;
beforeEach(()=>useHub.getState().reset());
afterEach(()=>useHub.persist.setOptions({storage}));
it('员工保存补齐缺省竞业字段并保留true，错误类型不写入',()=>{
 const employee={...useHub.getState().employees[0]};delete employee.nonCompeteSigned;
 useHub.getState().saveEmployee(employee);expect(useHub.getState().employees.find(e=>e.id===employee.id)?.nonCompeteSigned).toBe(false);
 useHub.getState().saveEmployee({...employee,nonCompeteSigned:true});expect(useHub.getState().employees.find(e=>e.id===employee.id)?.nonCompeteSigned).toBe(true);
 const revision=useHub.getState().revision;
 expect(()=>useHub.getState().saveEmployee({...employee,nonCompeteSigned:'false'} as never)).toThrow('布尔');
 expect(useHub.getState().revision).toBe(revision);expect(useHub.getState().employees.find(e=>e.id===employee.id)?.nonCompeteSigned).toBe(true);
});
it('旧持久化员工补false而不改已有工资快照',async()=>{
 const saved=structuredClone(useHub.persist.getOptions().partialize!(useHub.getState())) as ReturnType<typeof useHub.getState>;
 saved.employees.forEach(e=>delete e.nonCompeteSigned);saved.employees[1].nonCompeteSigned=true;
 const batches=structuredClone(saved.batches);
 useHub.persist.setOptions({storage:{getItem:()=>({state:saved,version:1}),setItem:()=>{},removeItem:()=>{}}});
 await useHub.persist.rehydrate();
 expect(useHub.getState().employees[0].nonCompeteSigned).toBe(false);expect(useHub.getState().employees[1].nonCompeteSigned).toBe(true);
 expect(useHub.getState().batches).toEqual(batches);expect(useHub.persist.getOptions().version).toBe(1);
});
