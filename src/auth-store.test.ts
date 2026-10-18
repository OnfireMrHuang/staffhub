import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHub } from './store';
import { DEMO_PASSWORD } from './auth';
beforeEach(()=>{useHub.getState().logout();useHub.getState().reset()});
afterEach(()=>vi.useRealTimers());
const savedState=()=>JSON.parse(JSON.stringify(useHub.persist.getOptions().partialize!(useHub.getState())));
const restore=(saved:unknown)=>useHub.persist.getOptions().merge!(saved,useHub.getState());
it('管理员登录后接近十二小时仍能恢复会话，到十二小时重新登录',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
 useHub.getState().loginPassword('admin',DEMO_PASSWORD);
 const saved=savedState();useHub.getState().logout();
 vi.advanceTimersByTime(12*60*60*1000-1);
 expect(restore(saved).session?.kind).toBe('admin');
 vi.advanceTimersByTime(1);
 expect(restore(saved).session).toBeNull();
});
it('员工密码和SSO会话恢复后仍进入本人资料',()=>{
 const employee=useHub.getState().employees[1];
 for(const login of [()=>useHub.getState().loginPassword(employee.id,DEMO_PASSWORD),()=>useHub.getState().loginSso('飞书',employee.id)]){
  login();const saved=savedState();useHub.getState().logout();
  expect(restore(saved)).toMatchObject({session:{kind:'employee',employeeId:employee.id},perspective:'employee',page:'profile'});
 }
});
it('页面持续打开时十二小时到期清除会话，期间业务操作不延长有效期',()=>{
 vi.useFakeTimers();useHub.getState().loginPassword('admin',DEMO_PASSWORD);
 vi.advanceTimersByTime(11*60*60*1000);useHub.getState().navigate('rules');
 useHub.getState().checkSessionExpiry();expect(useHub.getState().session?.kind).toBe('admin');
 vi.advanceTimersByTime(60*60*1000);useHub.getState().checkSessionExpiry();
 expect(useHub.getState().session).toBeNull();
});
it('主动退出后不可恢复登录，旧存档和无有效期限会话要求重新登录',()=>{
 useHub.getState().loginPassword('admin',DEMO_PASSWORD);const saved=savedState();
 useHub.getState().logout();expect(restore(savedState()).session).toBeNull();
 delete saved.sessionExpiresAt;expect(restore(saved).session).toBeNull();
 delete saved.session;expect(restore(saved).session).toBeNull();
});
it('员工离职后刷新不可恢复会话',()=>{
 const employee=useHub.getState().employees[1];useHub.getState().loginPassword(employee.id,DEMO_PASSWORD);
 const saved=savedState();saved.employees=saved.employees.map((e:typeof employee)=>e.id===employee.id?{...e,status:'已离职'}:e);
 expect(restore(saved).session).toBeNull();
});
it('未登录不持有演示会话，管理员密码登录进入工作台',()=>{expect(useHub.getState().session).toBeNull();useHub.getState().loginPassword('admin',DEMO_PASSWORD);expect(useHub.getState().session?.kind).toBe('admin');expect(useHub.getState().page).toBe('operations');});
it('员工密码登录进入自己而不是首位员工的资料',()=>{const employee=useHub.getState().employees[1];useHub.getState().loginPassword(employee.id,DEMO_PASSWORD);expect(useHub.getState().session?.employeeId).toBe(employee.id);expect(useHub.getState().perspective).toBe('employee');expect(useHub.getState().page).toBe('profile');});
it('错误密码不能创建会话',()=>{expect(()=>useHub.getState().loginPassword('admin','wrong')).toThrow('用户名或密码');expect(useHub.getState().session).toBeNull();});
it('员工登录后不能通过演示视角切换获得管理员菜单',()=>{const e=useHub.getState().employees[1];useHub.getState().loginPassword(e.id,DEMO_PASSWORD);useHub.getState().setPerspective('admin');expect(useHub.getState().perspective).toBe('employee');});
it('退出登录清除运行时会话但保留业务数据',()=>{useHub.getState().loginPassword('admin',DEMO_PASSWORD);const records=useHub.getState().liveRecords;useHub.getState().logout();expect(useHub.getState().session).toBeNull();expect(useHub.getState().liveRecords).toEqual(records);});
it('SSO作为辅助入口使用相同员工账号',()=>{const e=useHub.getState().employees[1];useHub.getState().loginSso('飞书',e.id);expect(useHub.getState().session).toMatchObject({kind:'employee',employeeId:e.id,method:'sso'});expect(useHub.getState().page).toBe('profile');});
