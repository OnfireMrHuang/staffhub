import { scheduleTestMonth } from './payroll-test-fixtures';
import { expect, it } from 'vitest';
import { calculateCompensation, validateCompensationRoomOwnership } from './compensation-rules';
import { payrollSettlementExample as example } from './payroll-settlement-example';
import { useHub } from './store';
import expected from '../docs/examples/layered-payroll/expected.json';

it('reconciles the fictional example against independently calculated row and employee amounts', () => {
  expect(example.rules.every(rule => rule.scope !== 'employees' && rule.employeeCondition === undefined)).toBe(true);
  const source = structuredClone(example);
  const result = calculateCompensation(source.rows, source.employees, source.departments, source.rooms, source.rules, source.month);
  expect(result.rows.map(row => [row.allowance, row.guarantee, row.additions, row.performance, row.total])).toEqual([
    [450, 6600, 6800, 6800, 7250], [195, 4400, 3100, 4400, 4595], [165, 4400, 3800, 4400, 4565], [80, 2200, 1850, 2200, 2280],
  ]);
  expect(result.salaries.map(row => [row.employeeName, row.total])).toEqual([['林晓', 9530], ['周宁', 4595], ['陈雨', 4565]]);
  expect(result.salaries.reduce((sum, row) => sum + row.total, 0)).toBe(18690);
  expect(result.rows.map(row => [row.premium.roiAfter, row.premium.rank])).toEqual([[4, 1], [2.8, 3], [3.6, 2], [2.25, 1]]);
  for (const actual of result.rows) {
    const manual = expected.rows.find(row => row.employeeId === actual.employeeId && row.roomId === actual.roomId)!;
    expect(actual.scopes?.global).toMatchObject(manual.scopes.global);
    expect(actual.scopes?.rooms).toMatchObject(manual.scopes.rooms);
    expect(actual.scopes?.employees.matchedRuleIds).toEqual([]);
    expect(Object.fromEntries(actual.ruleCalculations!.map(rule => [rule.ruleId, rule.amount]))).toEqual(manual.rules);
    expect(actual.performance).toBe(manual.performance);
    expect(actual.total).toBe(actual.performance! + actual.allowance);
    expect(actual.total).toBe(manual.total);
  }
  expect(result.rows.reduce((sum, row) => sum + row.performance!, 0)).toBe(expected.performance);
  expect(source).toEqual(example);
});

it('publishes supported example rules and settles with original premiums through the real store', () => {
  const currentRules=example.rules.filter(rule=>rule.type!=='premium');
  const before = useHub.getState();
  try {
    useHub.getState().reset();
    for (const rule of example.rules) expect(() => validateCompensationRoomOwnership(rule, example.rules)).not.toThrow();
    useHub.setState({
      session: { kind: 'admin', username: 'admin', method: 'password' },
      month: example.month, employees: structuredClone(example.employees), departments: structuredClone(example.departments), rooms: structuredClone(example.rooms),
      products: [{ id: 'example-product', name: '示例产品', platform: '示例平台', accountId: 'example-product-account', active: true }],
      dataset: { rows: structuredClone(example.rows), month: example.month, revision: 1, version: 1, published: true },
      monthlyRows: structuredClone(example.rows), revision: 1, liveRecords: [], roomHours: [], adHours: [], compensationRules: [], compensationTasks: [], payrollTasks: [],
    });
    scheduleTestMonth();
    for (const rule of currentRules) {
      useHub.getState().saveCompensationRule({ ...structuredClone(rule), status: '草稿' });
      useHub.getState().publishCompensationRule(rule.id, example.month);
    }
    useHub.getState().runPayroll();
    const batch = useHub.getState().batch!;
    expect(batch.compensationResult!.rows).toHaveLength(4);
    expect(batch.salaries.reduce((sum, row) => sum + row.total, 0)).toBe(19590);
    expect(batch.compensationResult!.rows.every(row=>row.premium.after===row.premium.before)).toBe(true);
    expect(batch.snapshot.compensationTasks).toHaveLength(currentRules.length);
    expect(batch.snapshot.compensationTasks!.every(task => task.status === '已核算')).toBe(true);
  } finally {
    useHub.setState(before, true);
  }
});
