import { eligibleCompensationRows, payrollBatchInputIssue, type Batch, type CompensationTask, type PayrollTask, type useHub } from './store';
import type { CompensationRule } from './compensation-rules';
import type { MonthlyPayrollJob } from './payroll-schedule';

export type MonthlyTaskStatus = '待核算' | '待复核' | '待应用' | '待重新核算' | '已归档' | '已撤回';
export type MonthlyRuleTask = CompensationTask | PayrollTask;
export interface MonthlyPayrollTask {
 month: string;
 status: MonthlyTaskStatus;
 tasks: MonthlyRuleTask[];
 batch?: Batch;
 employees: number;
 updatedAt: string;
 job?: MonthlyPayrollJob;
 rules?: CompensationRule[];
}
type TaskState = ReturnType<typeof useHub.getState>;
export function monthlyPayrollTasks(state: TaskState): MonthlyPayrollTask[] {
 const batches = { ...state.batches, ...(state.batch ? { [state.batch.month]: state.batch } : {}) };
 const live = [...state.compensationTasks, ...state.payrollTasks];
 const months = new Set([...state.monthlyPayrollJobs.map(job=>job.month),...live.map(task => task.month), ...Object.keys(batches)]);
 return [...months].sort().reverse().map(month => {
  const batch = batches[month];
  const job = state.monthlyPayrollJobs.find(job=>job.month===month);
  const archived = state.archivedMonths.includes(month) || !!batch?.archivedAt;
  const tasks = batch && (archived || batch.ruleSource==='demo')
   ? [...(batch.snapshot.compensationTasks ?? []), ...batch.snapshot.payrollTasks].filter(task => task.month === month)
   : live.filter(task => task.month === month);
  const active = tasks.filter(task => task.status !== '已撤回');
  const inputIssue = batch && !archived ? payrollBatchInputIssue(state, batch) : '';
  const status: MonthlyTaskStatus = archived ? '已归档'
   : inputIssue ? '待重新核算' : batch?.review?.dirty ? '待应用' : batch ? '待复核' : job || active.length ? '待核算' : '已撤回';
  const dataset = state.dataset.month === month ? state.dataset : state.datasetsByMonth[month];
  const liveEmployees = (job || active.some(task => 'scope' in task)) && dataset?.published
   ? new Set(eligibleCompensationRows(dataset.rows, state.employees, state.rooms, state.products, month).map(row => row.employeeId)).size
   : new Set(active.flatMap(task => task.employeeIds)).size;
  const employees = batch && (archived || !inputIssue) ? batch.salaries.length : liveEmployees;
  const rules=job ? archived || batch?.ruleSource==='demo' ? active.filter((task):task is CompensationTask=>'scope' in task).map(task=>task.rule) : state.publishedCompensationRules : undefined;
  return { month, status, tasks, batch, employees,job,rules,
   updatedAt: batch?.review?.appliedAt ?? batch?.created ?? tasks.map(task => task.created).sort().at(-1) ?? (job ? new Date(job.createdAt).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}) : '') };
 });
}

/** An absent result and an existing version-zero result are distinct confirmations. */
export function payrollCalculationConfirmation(batch?: Batch): {type:'calculate';version?:number} {
 return {type:'calculate',version:batch ? batch.review?.version ?? 0 : undefined};
}
