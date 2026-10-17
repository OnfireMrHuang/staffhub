import { scheduleTestMonth } from '../payroll-test-fixtures';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SalaryModal } from './Payroll';
import { useHub } from '../store';
import type { CompensationRule } from '../compensation-rules';

vi.mock('../store', async importOriginal => {
 const actual = await importOriginal<typeof import('../store')>();
 const current = Object.assign(((selector?: (state: ReturnType<typeof actual.useHub.getState>) => unknown) => selector ? selector(actual.useHub.getState()) : actual.useHub.getState()) as typeof actual.useHub, actual.useHub);
 return { ...actual, useHub: current };
});
// Radix portals intentionally render no server HTML; inline only that presentation boundary.
vi.mock('../components', async importOriginal => ({
 ...await importOriginal<typeof import('../components')>(),
 Modal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <section>{children}</section> : null,
}));

it.each([2, undefined] as const)('uses the calculated frozen rule name and version after republication and draft edits (settlement %s)', settlementVersion => {
 const before = useHub.getState();
 try {
  const initial = useHub.getInitialState();
  const source = initial.dataset.rows.find(row => row.roles.includes('主播'))!;
  const row = { ...source, nightSessions: 2 };
  useHub.setState({
   ...initial, session:{kind:'admin',username:'admin',method:'password'}, month: row.month, employees: initial.employees.filter(employee => employee.id === row.employeeId),
   rooms: initial.rooms.filter(room => room.id === row.roomId), liveRecords: [], roomHours: [], adHours: [],
   dataset: { rows: [row], month: row.month, revision: 1, version: 1, published: true }, monthlyRows: [row], revision: 1,
   compensationRules: [], compensationTasks: [], payrollTasks: [], archivedMonths: [], batch: null, batches: {},
  }, true);
  scheduleTestMonth();
  const oldRule: CompensationRule = { id: 'history-allowance', name: '撤回的旧补贴A', version: 1, status: '草稿', scope: 'global', roomIds: [], type: 'allowance', allowance: { field: 'nightSessions', amount: 10 } };
  useHub.getState().saveCompensationRule(oldRule);
  useHub.getState().publishCompensationRule(oldRule.id, row.month);
  useHub.getState().saveCompensationRule({ ...oldRule, name: '实际核算补贴B', allowance: { field: 'nightSessions', amount: 30 } });
  useHub.getState().publishCompensationRule(oldRule.id, row.month);
  useHub.getState().runPayroll();
  const batch = structuredClone(useHub.getState().batch!);
  expect(batch.snapshot.compensationTasks?.map(task => [task.status, task.ruleVersion])).toEqual([['已核算', 2]]);
  expect(batch.salaries[0].total).toBe(60);
  batch.compensationResult!.settlementVersion = settlementVersion;
  useHub.setState({ batch, batches: { [row.month]: batch } });
  // Current drafts may change after archival; the modal must continue to use the calculated snapshot.
  useHub.getState().saveCompensationRule({ ...oldRule, name: '后改草稿C', allowance: { field: 'nightSessions', amount: 99 } });
  const html = renderToStaticMarkup(<SalaryModal salary={batch.salaries[0]} onClose={() => {}} month={row.month} version={batch.datasetVersion} />);
  expect(html).toContain('实际核算补贴B · v2');
  expect(html).toContain('¥60.00');
  expect(html).not.toContain('撤回的旧补贴A');
  expect(html).not.toContain('后改草稿C');
  const appliedSalary={...batch.salaries[0],total:75,commission:75};
  const appliedHtml=renderToStaticMarkup(<SalaryModal salary={appliedSalary} onClose={()=>{}} month={row.month} version={batch.datasetVersion}/>);
  expect(appliedHtml).toContain('当前已应用月薪 ¥75.00');
  expect(appliedHtml).toContain('以下为原始核算依据，原始月薪 ¥60.00');
  expect(appliedHtml).not.toContain('= ¥75.00');
 } finally { useHub.setState(before, true); }
});
