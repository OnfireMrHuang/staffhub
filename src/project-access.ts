import type { Project } from './domain';
export function prepareProjectAccess(project:Project,appId:string,secret:string):Project {
 const id=appId.trim(),hasSecret=secret.trim().length>0;
 if(!id&&!hasSecret&&!project.access?.secretConfigured)return {...project,access:undefined};
 if(!/^[1-9]\d*$/.test(id))throw new Error('app_id 须为正整数，请填写巨量引擎应用 ID。');
 if(!hasSecret&&(!project.access?.secretConfigured||project.access.appId!==id))throw new Error('首次配置或变更 app_id 时，请同时填写 secret。');
 // DEMO stores only the configured flag. A production backend must store a secret reference.
 return {...project,access:{appId:id,secretConfigured:true}};
}
