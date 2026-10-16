import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import { monthlyRowKey } from './dataset-corrections';
import type { CompensationRule } from './compensation-rules';

beforeEach(() => {
  useHub.getState().reset();
  const s = useHub.getState();
  const source = s.dataset.rows.find(row => row.roles.includes('主播'))!;
  const employee = s.employees.find(item => item.id === source.employeeId)!;
  const room = s.rooms.find(item => item.id === source.roomId)!;
  const rows = [
    { ...source, roles: ['主播'], hours: 10, nightHours: 2, earlyHours: 3, nightSessions: 2 },
    { ...source, employeeId: 'second-host', employeeName: '第二主播', roomId: 'second-room', roles: ['主播'], hours: 5, nightHours: 1, earlyHours: 1, nightSessions: 1 },
    { ...source, employeeId: 'buyer-only', employeeName: '投手', roles: ['投手'] },
  ];
  useHub.setState({
    month: source.month,
    employees: [employee, { ...employee, id: 'second-host', name: '第二主播' }, { ...employee, id: 'buyer-only', name: '投手', position: '投手' }],
    rooms: [room, { ...room, id: 'second-room', name: '第二直播间' }],
    dataset: { rows, month: source.month, revision: 1, version: 1, published: true },
    monthlyRows: rows, liveRecords: [], roomHours: [], adHours: [], revision: 1, compensationRules: [], compensationTasks: [], payrollTasks: [],
  });
});

function publish(scope: 'global' | 'rooms' = 'global') {
  const s = useHub.getState();
  const rule: CompensationRule = { id: 'settlement-allowance', name: '夜班补贴', version: 1, status: '草稿', scope, roomIds: scope === 'rooms' ? [s.rooms[0].id] : [], type: 'allowance', allowance: { field: 'nightSessions', amount: 20 } };
  s.saveCompensationRule(rule);
  useHub.getState().publishCompensationRule(rule.id, s.month);
}

it('publishes only host participants from the monthly source', () => {
  publish();
  const s = useHub.getState();
  expect(s.compensationTasks[0].employeeIds).toEqual([s.employees[0].id, 'second-host'].sort());
  expect(s.compensationTasks[0].rowKeys).toEqual(s.dataset.rows.filter(row => row.roles.includes('主播')).map(monthlyRowKey).sort());
});

it('imports unmatched hosts with zero salary when only one room has rules', () => {
  publish('rooms');
  useHub.getState().runPayroll();
  const result = useHub.getState().batch!.compensationResult!;
  expect(result.rows.map(row => row.employeeId)).toEqual([useHub.getState().employees[0].id, 'second-host']);
  expect(result.salaries.find(row => row.employeeId === 'second-host')!.total).toBe(0);
  expect(result.salaries.some(row => row.employeeId === 'buyer-only')).toBe(false);
});

it('freezes source statistics and scope amounts alongside the settlement version', () => {
  publish();
  useHub.getState().runPayroll();
  const s = useHub.getState();
  const result = structuredClone(s.batch!.compensationResult!);
  expect(result).toMatchObject({ settlementVersion: 2 });
  expect(result.rows[0]).toMatchObject({ statistics: { hours: 10, nightSessions: 2 }, scopes: { global: { allowance: 40, guarantee: 0, additions: 0 } }, total: 40 });
  useHub.setState({ dataset: { ...s.dataset, rows: s.dataset.rows.map(row => ({ ...row, hours: 99 })) } });
  useHub.getState().lockBatch();
  useHub.getState().publishBatch();
  expect(useHub.getState().batch!.compensationResult).toEqual(result);
  const options = useHub.persist.getOptions();
  const saved = JSON.parse(JSON.stringify(options.partialize!(useHub.getState())));
  expect(options.merge!(saved, useHub.getInitialState()).batch!.compensationResult).toEqual(result);
});

it('requires republication when a confirmed host changes to a non-host role', () => {
  publish();
  const s = useHub.getState();
  useHub.setState({ dataset: { ...s.dataset, rows: s.dataset.rows.map(row => row.employeeId === 'second-host' ? { ...row, roles: ['投手'] } : row) } });
  expect(() => useHub.getState().runPayroll()).toThrow(/名单|粒度/);
  expect(useHub.getState().batch).toBeNull();
  expect(useHub.getState().compensationTasks[0].status).toBe('待核算');
});
