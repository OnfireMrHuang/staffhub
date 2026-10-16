import type { Employee } from './domain';
/** Missing historical values follow the employee field's false default. */
export function withEmployeeDefaults(employee:Employee):Employee {
 if(employee.nonCompeteSigned!==undefined&&typeof employee.nonCompeteSigned!=='boolean') throw new Error('是否签约竞业协议必须为布尔值');
 return {...employee,nonCompeteSigned:employee.nonCompeteSigned??false};
}
