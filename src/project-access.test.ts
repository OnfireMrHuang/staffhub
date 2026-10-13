import { expect, it } from 'vitest';
import { prepareProjectAccess } from './project-access';
import type { Project } from './domain';
const project:Project={id:'p',name:'项目',code:'P',platform:'腾讯广告',account:'ad-1',active:true,liveAccountIds:['room-1']};
it('三个平台应用ID接受文本，凭据仅保存配置标记',()=>{
 for(const platform of ['巨量引擎','腾讯广告','快手磁力引擎']){
  const saved=prepareProjectAccess({...project,platform},' app-demo_A-1 ','fiction-secret','fiction-code');
  expect(saved.access).toEqual({appId:'app-demo_A-1',secretConfigured:true,authCodeConfigured:true});
  expect(JSON.stringify(saved)).not.toContain('fiction-secret');
  expect(JSON.stringify(saved)).not.toContain('fiction-code');
 }
});
it('首次配置应用必须配密钥，授权码必须依附完整应用配置',()=>{
 expect(()=>prepareProjectAccess(project,'app-A','')).toThrow('secret');
 expect(()=>prepareProjectAccess(project,'','secret')).toThrow('应用 ID');
 expect(()=>prepareProjectAccess(project,'','','code')).toThrow('应用');
});
it('留空保留状态，变更应用必须重配密钥且清除旧应用授权标记',()=>{
 const old=prepareProjectAccess(project,'app-A','secret','code');
 expect(prepareProjectAccess(old,'app-A','').access).toEqual(old.access);
 expect(()=>prepareProjectAccess(old,'app-B','')).toThrow('secret');
 expect(prepareProjectAccess(old,'app-B','new-secret').access).toEqual({appId:'app-B',secretConfigured:true,authCodeConfigured:false});
 expect(prepareProjectAccess(old,'app-B','new-secret','new-code').access?.authCodeConfigured).toBe(true);
});
it('切换平台必须重配密钥和授权码，未配置项目可先保存',()=>{
 const old=prepareProjectAccess(project,'app-A','secret','code');
 expect(()=>prepareProjectAccess({...old,platform:'快手磁力引擎'},'app-A','', '', old.platform)).toThrow('secret');
 expect(prepareProjectAccess({...old,platform:'快手磁力引擎'},'app-A','new-secret','',old.platform).access?.authCodeConfigured).toBe(false);
 expect(prepareProjectAccess(project,'','').access).toBeUndefined();
});
