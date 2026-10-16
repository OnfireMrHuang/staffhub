import type { LiveDetail, LiveMonthly } from '../live-domain';
export const detailFields: {key:keyof LiveDetail;label:string}[]=[{key:'spend',label:'消耗（元）'},{key:'revenue',label:'成交金额（元）'},{key:'clicks',label:'点击次数'},{key:'clickRate',label:'点击率'},{key:'clickCost',label:'点击单价（元）'},{key:'conversionRate',label:'转化率'},{key:'conversions',label:'转化数'},{key:'conversionCost',label:'转化成本（元）'},{key:'roi',label:'ROI'},{key:'orders',label:'下单数'},{key:'viewers',label:'观看人次'}];
export const monthlyDimensions: {key:keyof LiveMonthly;label:string}[]=[
 {key:'employeeId',label:'员工ID'},{key:'employeeName',label:'员工名称'},
 {key:'departmentId',label:'部门ID'},{key:'departmentName',label:'部门名称'},
 {key:'employeeJoinedOn',label:'入职日期'},{key:'nonCompeteSigned',label:'是否签约竞业协议'},
 {key:'productId',label:'产品ID'},{key:'productName',label:'产品名称'},
 {key:'roomId',label:'直播间ID'},{key:'roomName',label:'直播间名称'},
 {key:'roomOpenedOn',label:'直播间开播时间'},{key:'year',label:'年份'},{key:'month',label:'月份'},
];
export const monthlyFields: {key:keyof LiveMonthly;label:string}[]=[
 {key:'hours',label:'总直播时长'},{key:'nightHours',label:'夜班直播时长'},
 {key:'earlyHours',label:'早班直播时长'},{key:'regularHours',label:'正常直播时长'},
 {key:'nightSessions',label:'夜班场次'},{key:'earlySessions',label:'早班场次'},
 {key:'spend',label:'总消耗'},{key:'nightSpend',label:'夜班消耗'},
 {key:'earlySpend',label:'早班消耗'},{key:'regularSpend',label:'正常消耗'},
 {key:'premium',label:'总保费'},{key:'nightPremium',label:'夜班保费'},
 {key:'earlyPremium',label:'早班保费'},{key:'regularPremium',label:'正常保费'},
 {key:'roi',label:'ROI'},{key:'hourlySpend',label:'时耗'},
 {key:'adCost',label:'AD成本'},{key:'policyCost',label:'保单成本'},
 {key:'roiRank',label:'ROI排名'},{key:'spendRank',label:'消耗排名'},
];
export const monthlyColumns=[...monthlyDimensions,...monthlyFields];
export const pendingMonthlyFields=new Set<keyof LiveMonthly>(['adCost','policyCost']);
export const monthlyCountFields=new Set<keyof LiveMonthly>(['roiRank','spendRank','nightSessions','earlySessions']);
export function monthlyCellValue(row:LiveMonthly,key:keyof LiveMonthly):string|number {
 if(pendingMonthlyFields.has(key)) return '待定义';
 const value=row[key];
 if(key==='month') return row.month.slice(5);
 if(typeof value==='boolean') return value?'是':'否';
 if(value===undefined||value===null||value==='') return '未定义';
 return typeof value==='number'||typeof value==='string'?value:String(value);
}
export const monthlyExportRows=(rows:LiveMonthly[])=>rows.map(row=>Object.fromEntries(monthlyColumns.map(field=>[field.label,monthlyCellValue(row,field.key)])));
