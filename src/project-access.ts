import type { Project } from './domain';
export function prepareProjectAccess(project:Project,appId:string,secret:string,authCode='',previousPlatform=project.platform):Project {
 const id=appId.trim(),hasSecret=secret.trim().length>0,hasCode=authCode.trim().length>0;
 const sameApp=project.access?.appId===id&&previousPlatform===project.platform;
 if(!id&&!hasSecret&&!hasCode&&!project.access?.secretConfigured)return {...project,access:undefined};
 if(!id)throw new Error('请填写应用 ID，授权码须依附完整应用配置。');
 if(!hasSecret&&(!project.access?.secretConfigured||!sameApp))throw new Error('首次配置、变更应用 ID 或平台时，请同时填写 secret。');
 // Credentials stay in the form; the demo persists only configuration flags.
 return {...project,access:{appId:id,secretConfigured:true,authCodeConfigured:hasCode||(sameApp&&!!project.access?.authCodeConfigured)}};
}
