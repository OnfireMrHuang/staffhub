import type { CompensationRule } from './compensation-rules';

/** Only normalize editable current definitions. Frozen task and payroll snapshots must never pass through here. */
export function normalizeCurrentCompensationRule(source: CompensationRule): CompensationRule {
  if (source.scope !== 'employees' && !(source.scope === 'global' && source.employeeCondition !== undefined)) return source;
  const rule = structuredClone(source);
  rule.scope = 'global';
  rule.roomIds = [];
  delete rule.employeeCondition;
  delete rule.roomRuleSetId;
  rule.version = Math.max(1, source.version + 1);
  rule.status = '草稿';
  return rule;
}
