import { expect, it } from 'vitest';
import { calculateCompensation, validateCompensationRoomOwnership } from './compensation-rules';
import { payrollSettlementExample as example } from './payroll-settlement-example';
import { useHub } from './store';

it('reconciles the fictional example against independently calculated row and employee amounts', () => {
  const source = structuredClone(example);
  const result = calculateCompensation(source.rows, source.employees, source.departments, source.rooms, source.rules, source.month);
  expect(result.rows.map(row => [row.allowance, row.guarantee, row.additions, row.total])).toEqual([
    [450, 6600, 6800, 7250], [120, 4000, 3000, 4120], [165, 4400, 3800, 4565], [80, 2200, 1850, 2280],
  ]);
  expect(result.salaries.map(row => [row.employeeName, row.total])).toEqual([['林晓', 9530], ['周宁', 4120], ['陈雨', 4565]]);
  expect(result.salaries.reduce((sum, row) => sum + row.total, 0)).toBe(18215);
  expect(result.rows.map(row => [row.premium.roiAfter, row.premium.rank])).toEqual([[4, 1], [2.8, 3], [3.6, 2], [2.25, 1]]);
  expect(source).toEqual(example);
});

it('publishes the example under current room ownership and settles through the real store', () => {
  const before = useHub.getState();
  try {
    useHub.getState().reset();
    for (const rule of example.rules) expect(() => validateCompensationRoomOwnership(rule, example.rules)).not.toThrow();
    useHub.setState({
      month: example.month, employees: structuredClone(example.employees), departments: structuredClone(example.departments), rooms: structuredClone(example.rooms),
      products: [{ id: 'example-product', name: '示例产品', platform: '示例平台', accountId: 'example-product-account', active: true }],
      dataset: { rows: structuredClone(example.rows), month: example.month, revision: 1, version: 1, published: true },
      monthlyRows: structuredClone(example.rows), revision: 1, liveRecords: [], roomHours: [], adHours: [], compensationRules: [], compensationTasks: [], payrollTasks: [],
    });
    for (const rule of example.rules) {
      useHub.getState().saveCompensationRule({ ...structuredClone(rule), status: '草稿' });
      useHub.getState().publishCompensationRule(rule.id, example.month);
    }
    useHub.getState().runPayroll();
    const batch = useHub.getState().batch!;
    expect(batch.compensationResult!.rows).toHaveLength(4);
    expect(batch.salaries.reduce((sum, row) => sum + row.total, 0)).toBe(18215);
    expect(batch.snapshot.compensationTasks).toHaveLength(example.rules.length);
    expect(batch.snapshot.compensationTasks!.every(task => task.status === '已核算')).toBe(true);
  } finally {
    useHub.setState(before, true);
  }
});
