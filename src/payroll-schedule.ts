/** Monthly jobs are keyed by salary month. Scheduling uses Asia/Shanghai, not browser locale. */
export interface MonthlyPayrollJob { id:string; month:string; scheduledAt:string; createdAt:string }
export function previousPayrollMonth(now:Date):string {
 if(!Number.isFinite(now.getTime())) throw new Error('调度时间无效');
 const local=new Date(now.getTime()+8*60*60*1000);
 local.setUTCDate(1);local.setUTCMonth(local.getUTCMonth()-1);
 return local.toISOString().slice(0,7);
}
export function duePayrollJobs(startMonth:string,now:Date,existingMonths:Set<string>):MonthlyPayrollJob[] {
 const end=previousPayrollMonth(now);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) throw new Error('调度起始月份无效');
 const jobs:MonthlyPayrollJob[]=[];
 for(let month=startMonth;month<=end;) {
  const next=new Date(`${month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  const following=next.toISOString().slice(0,7);
  if(!existingMonths.has(month)) jobs.push({id:`payroll-${month}`,month,scheduledAt:`${following}-01T00:00:00+08:00`,createdAt:now.toISOString()});
  month=following;
 }
 return jobs;
}
