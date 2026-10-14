import type { AdvertisingProduct } from './operations-domain';
export function prepareProductAccess(product:AdvertisingProduct,appId:string,secret:string,authCode='',previousPlatform=product.platform):AdvertisingProduct {
 const id=appId.normalize('NFKC').trim(),hasSecret=secret.trim().length>0,hasCode=authCode.trim().length>0;
 const sameApp=product.access?.appId===id&&previousPlatform===product.platform;
 if(!id&&!hasSecret&&!hasCode&&!product.access?.secretConfigured)return {...product,access:undefined};
 if(!id)throw new Error('请填写应用 ID，授权码须依附完整应用配置。');
 if(!hasSecret&&(!product.access?.secretConfigured||!sameApp))throw new Error('首次配置、变更应用 ID 或平台时，请同时填写 secret。');
 return {...product,access:{appId:id,secretConfigured:true,authCodeConfigured:hasCode||(sameApp&&!!product.access?.authCodeConfigured)}};
}
