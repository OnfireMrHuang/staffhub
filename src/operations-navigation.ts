export const operationSections = [
 {id:'products',label:'投放产品',description:'维护产品平台、投放账户与应用访问配置。'},
 {id:'rooms',label:'直播间',description:'维护直播间账户和关联产品，报表定义由后台关联。'},
 {id:'raw',label:'直播原始统计数据',description:'管理直播记录及平台逐小时来源，作为后续报表的原始依据。'},
 {id:'hourly',label:'时报',description:'按直播间查看固定时报，核对每小时数据与人员归属。'},
 {id:'daily',label:'日报',description:'按直播间查看固定日报，使用有效时报按日汇总。'},
 {id:'monthly',label:'员工月度汇总',description:'汇总所有员工和直播间的有效日报，为部门薪酬规则提供统一依据。'},
] as const;
export type OperationSection = typeof operationSections[number]['id'];
export function normalizeOperationSection(value?:string):OperationSection {
 const aliases:Record<string,OperationSection>={projects:'rooms',input:'raw',datasets:'monthly'};
 if(value && aliases[value])return aliases[value];
 return operationSections.some(item=>item.id===value)?value as OperationSection:'monthly';
}
