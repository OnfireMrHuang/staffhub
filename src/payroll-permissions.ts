import type { DemoSession } from './auth';
import type { Employee } from './domain';

export type PayrollPermission = '薪酬核算' | '薪酬结果编辑' | '薪酬归档' | '工资发布';
interface PayrollPrincipal {
 session: DemoSession | null;
 employees: Employee[];
 roles: { id: string; permissions: string[] }[];
}

/** Demo permission boundary; production must enforce the same checks on the server. */
export function canPayroll(state:PayrollPrincipal, permission:PayrollPermission):boolean {
 if(state.session?.kind==='admin')return true;
 if(state.session?.kind!=='employee')return false;
 const employee=state.employees.find(item=>item.id===state.session!.employeeId&&item.status==='在职');
 return !!employee&&state.roles.some(role=>role.id===employee.role&&role.permissions.includes(permission));
}

export function canViewPayroll(state:PayrollPrincipal):boolean {
 return (['薪酬核算','薪酬结果编辑','薪酬归档','工资发布'] as const).some(permission=>canPayroll(state,permission));
}
