import { describe, expect, it } from 'vitest';
import { normalizeCurrentCompensationRule } from './compensation-rule-migration';
import { calculateCompensation, validateCompensationRule, type CompensationRule } from './compensation-rules';
import { payrollSettlementExample as example } from './payroll-settlement-example';

const oldRule = (): CompensationRule => ({
  id: 'legacy-employee', name: '原员工补贴', version: 3, status: '已发布', scope: 'employees', roomIds: [],
  employeeCondition: { kind: 'group', operator: 'and', children: [{ kind: 'condition', field: 'employee.nonCompeteSigned', operator: 'eq', value: true }] },
  type: 'allowance', allowance: { field: 'nightSessions', amount: 15 },
});

describe('current employee-rule migration', () => {
  it('redrafts widened global rules once without changing frozen source objects', () => {
    const source = oldRule(), frozen = structuredClone(source);
    const rule = normalizeCurrentCompensationRule(source);
    expect(rule).toMatchObject({ id: source.id, name: source.name, scope: 'global', status: '草稿', version: 4, allowance: source.allowance });
    expect(rule).not.toHaveProperty('employeeCondition');
    expect(normalizeCurrentCompensationRule(rule)).toBe(rule);
    expect(source).toEqual(frozen);
    expect(() => validateCompensationRule(source)).not.toThrow();
  });

  it('removes obsolete global employee conditions and refuses them at the calculation boundary', () => {
    const source = { ...oldRule(), scope: 'global' as const };
    expect(() => validateCompensationRule(source)).toThrow();
    expect(normalizeCurrentCompensationRule(source)).toMatchObject({ scope: 'global', status: '草稿', version: 4 });
    expect(normalizeCurrentCompensationRule(source)).not.toHaveProperty('employeeCondition');
  });

  it('applies migrated rules to unsigned eligible hosts while frozen employee rules retain their original filter', () => {
    const frozen = oldRule(), global = { ...normalizeCurrentCompensationRule(frozen), status: '已发布' as const };
    const run = (rule: CompensationRule) => calculateCompensation(example.rows, example.employees, example.departments, example.rooms, [rule], example.month);
    expect(run(frozen).rows.find(row => row.employeeId === 'example-zhou')?.allowance).toBe(0);
    expect(run(global).rows.find(row => row.employeeId === 'example-zhou')?.allowance).toBe(75);
  });
});
