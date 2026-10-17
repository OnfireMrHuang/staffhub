import { useHub } from './store';

/** Simulate the scheduler on the first day following the selected salary month. */
export function scheduleTestMonth() {
 const next = new Date(`${useHub.getState().month}-01T00:00:00Z`);
 next.setUTCMonth(next.getUTCMonth() + 1);
 useHub.getState().ensureMonthlyPayrollJobs(next);
}

/** Historical saves held rule input snapshots before calculation. Keep that migration path covered. */
export function loadLegacyPendingInputs() {
 scheduleTestMonth();
 useHub.getState().runPayroll();
 const tasks = useHub.getState().compensationTasks.map(task => ({ ...task, status: '待核算' as const }));
 useHub.setState({ monthlyPayrollJobs: [], compensationTasks: tasks, batch: null, batches: {} });
}
