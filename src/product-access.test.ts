import { expect, it } from 'vitest';
import type { AdvertisingProduct } from './operations-domain';
import { prepareProductAccess } from './product-access';
const product:AdvertisingProduct={id:'PRODUCT001',name:'甲产品',platform:'巨量引擎',accountId:'AD001',active:true};
it('仅保存应用标识和配置标记，不保存原始凭据',()=>{
 const saved=prepareProductAccess(product,' APP001 ','fake-secret','fake-code');
 expect(saved.access).toEqual({appId:'APP001',secretConfigured:true,authCodeConfigured:true});
 expect(JSON.stringify(saved)).not.toContain('fake-secret');expect(JSON.stringify(saved)).not.toContain('fake-code');
});
it('同应用保留标记，变更应用需密钥并清除旧授权码标记',()=>{
 const saved=prepareProductAccess(product,'APP001','secret','code');
 expect(prepareProductAccess(saved,'APP001','').access?.authCodeConfigured).toBe(true);
 expect(()=>prepareProductAccess(saved,'APP002','')).toThrow('secret');
 expect(prepareProductAccess(saved,'APP002','new-secret').access?.authCodeConfigured).toBe(false);
 expect(()=>prepareProductAccess({...saved,platform:'磁力引擎'},'APP001','','',saved.platform)).toThrow('secret');
});
