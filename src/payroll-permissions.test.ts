import { expect, it } from 'vitest';
import { canPayroll, canViewPayroll } from './payroll-permissions';
import { useHub } from './store';

it('restricts payroll archive to an administrator or active employee with the archive permission',()=>{
 const s=useHub.getInitialState(),employee={...s.employees[0],role:'reviewer'};
 const state={employees:[employee],roles:[{id:'reviewer',permissions:['薪酬核算']}],session:{kind:'employee' as const,employeeId:employee.id,username:employee.id,method:'password' as const}};
 expect(canViewPayroll(state)).toBe(true);
 expect(canPayroll(state,'薪酬归档')).toBe(false);
 expect(canPayroll(state,'工资发布')).toBe(false);
 state.roles[0].permissions.push('薪酬归档');
 expect(canPayroll(state,'薪酬归档')).toBe(true);
 expect(canPayroll({...state,employees:[{...employee,status:'已离职'}]},'薪酬归档')).toBe(false);
 expect(canPayroll({...state,session:null},'薪酬归档')).toBe(false);
 expect(canPayroll({...state,session:{kind:'admin',username:'admin',method:'password'}},'薪酬归档')).toBe(true);
 const publisher={...state,roles:[{id:'reviewer',permissions:['工资发布']}]};
 expect(canViewPayroll(publisher)).toBe(true);
 expect(canPayroll(publisher,'工资发布')).toBe(true);
 expect(canPayroll(publisher,'薪酬归档')).toBe(false);
});
