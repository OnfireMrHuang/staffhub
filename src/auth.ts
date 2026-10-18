import type { Employee } from './domain';
// Public demo fixtures only. Production credentials are never handled by this frontend.
export const DEMO_PASSWORD = 'StaffHub@2026';
export const DEMO_ADMIN_USERNAME = 'admin';
export const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
export interface DemoSession {kind:'admin'|'employee';username:string;employeeId?:string;method:'password'|'sso'}
export function authenticatePassword(username:string,password:string,employees:Employee[]):DemoSession {
 const loginName=username.trim().toLowerCase();
 const fail=()=>{throw new Error('用户名或密码不正确，或账号不可用');};
 if(password!==DEMO_PASSWORD) return fail();
 if(loginName===DEMO_ADMIN_USERNAME)return {kind:'admin',username:DEMO_ADMIN_USERNAME,method:'password'};
 const employee=employees.find(e=>e.id.toLowerCase()===loginName);
 if(!employee||employee.status!=='在职')return fail();
 return {kind:'employee',username:employee.id,employeeId:employee.id,method:'password'};
}
export function authenticateSso(platform:string,employeeId:string,employees:Employee[]):DemoSession {
 const employee=employees.find(e=>e.id===employeeId);
 if(!employee)throw new Error('平台身份未绑定，请使用账号密码登录或联系 HR。');
 if(employee.status!=='在职')throw new Error('账号不可用，请联系 HR。');
 if(!['企业微信','钉钉','飞书'].includes(platform)||!employee.identities.includes(platform))throw new Error('平台身份未绑定，请使用账号密码登录或联系 HR。');
 return {kind:'employee',username:employee.id,employeeId:employee.id,method:'sso'};
}
