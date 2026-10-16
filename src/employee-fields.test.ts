import { expect, it } from 'vitest';
import { withEmployeeDefaults } from './employee-fields';
import { seedEmployees } from './real-seed';
it('历史员工缺少竞业字段时默认为false，已维护布尔值保留',()=>{
 const employee={...seedEmployees[0]};delete employee.nonCompeteSigned;
 expect(withEmployeeDefaults(employee).nonCompeteSigned).toBe(false);
 expect(withEmployeeDefaults({...employee,nonCompeteSigned:true}).nonCompeteSigned).toBe(true);
});
it('竞业字段拒绝字符串等非布尔输入',()=>{
 expect(()=>withEmployeeDefaults({...seedEmployees[0],nonCompeteSigned:'true'} as never)).toThrow('布尔');
});
