import { beforeEach, expect, it } from 'vitest';
import { prepareProjectAccess } from './project-access';
import { useHub } from './store';
beforeEach(()=>useHub.getState().reset());

it('新配置需要同时提供应用ID和密钥',()=>{
 const p=useHub.getState().projects[0];
 expect(()=>prepareProjectAccess(p,'123456','')).toThrow('secret');
 expect(()=>prepareProjectAccess(p,'','demo-only-secret')).toThrow('app_id');
 expect(()=>prepareProjectAccess(p,'abc','demo-only-secret')).toThrow('app_id');
});
it('保存演示状态和应用ID，但不保留密钥内容',()=>{
 const p=prepareProjectAccess(useHub.getState().projects[0],' 123456 ','demo-only-secret');
 expect(p.access).toMatchObject({appId:'123456',secretConfigured:true});
 expect(JSON.stringify(p)).not.toContain('demo-only-secret');
 useHub.getState().saveProject(p);
 expect(JSON.stringify(useHub.getState().projects)).not.toContain('demo-only-secret');
});
it('编辑时留空保留已配置状态，改变应用ID时要求重新输入密钥',()=>{
 const p=prepareProjectAccess(useHub.getState().projects[0],'123456','demo-only-secret');
 expect(prepareProjectAccess(p,'123456','').access).toEqual(p.access);
 expect(()=>prepareProjectAccess(p,'654321','')).toThrow('secret');
 expect(prepareProjectAccess(p,'654321','replacement-demo-secret').access?.appId).toBe('654321');
});
it('允许项目未配置应用，旧演示项目保持可编辑',()=>{
 const p={...useHub.getState().projects[0],access:undefined};
 expect(prepareProjectAccess(p,'','').access).toBeUndefined();
});
