import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';
import { useHub } from './store';
import { DEMO_PASSWORD } from './auth';

vi.mock('./store',async importOriginal=>{
 const actual=await importOriginal<typeof import('./store')>();
 const current=Object.assign(((selector?:(state:ReturnType<typeof actual.useHub.getState>)=>unknown)=>selector?selector(actual.useHub.getState()):actual.useHub.getState()) as typeof actual.useHub,actual.useHub);
 return {...actual,useHub:current};
});
beforeEach(()=>{useHub.getState().logout();useHub.getState().reset()});
const navigation=()=>renderToStaticMarkup(<App/>).match(/<nav aria-label="主导航">([\s\S]*?)<\/nav>/)![1];

it('薪酬两个入口归于员工薪酬管理并反映当前二级页面',()=>{
 useHub.getState().loginPassword('admin',DEMO_PASSWORD);useHub.getState().navigate('rules');
 const html=navigation();
 expect(html).toContain('运营数据管理');
 expect(html).not.toContain('运营工作台');
 const group=html.match(/id="payroll-subnav"[^>]*>([\s\S]*?)<\/div>/)![1];
 expect(group).toMatch(/aria-current="page"[^>]*>薪酬规则/);
 expect(group).toContain('薪酬核算');
 expect(html).toMatch(/aria-controls="payroll-subnav"[\s\S]*?员工薪酬管理/);
 useHub.getState().navigate('payroll');
 expect(navigation()).toMatch(/aria-current="page"[^>]*>薪酬核算/);
});
it('具有核算权限的员工仅显示薪酬核算二级入口',()=>{
 const s=useHub.getState(),employee=s.employees[1];
 useHub.setState({employees:s.employees.map(e=>e.id===employee.id?{...e,role:'payroll-test'}:e),roles:[...s.roles,{id:'payroll-test',name:'核算员',description:'',permissions:['薪酬核算']}]});
 useHub.getState().loginPassword(employee.id,DEMO_PASSWORD);
 const html=navigation();
 expect(html).toContain('员工薪酬管理');expect(html).toContain('薪酬核算');expect(html).not.toContain('薪酬规则');
});
it('普通员工没有运营或薪酬管理导航',()=>{
 const s=useHub.getState(),employee=s.employees[1];useHub.setState({roles:[]});
 useHub.getState().loginPassword(employee.id,DEMO_PASSWORD);
 const html=navigation();expect(html).toContain('本人资料');expect(html).not.toContain('员工薪酬管理');expect(html).not.toContain('运营数据管理');
});
