import { monthlyRowKey, type MonthlyOverride } from '../dataset-corrections';
import type { LiveMonthly } from '../live-domain';

// Mutations address the visible row; audit history follows the original override identity.
export function monthlyCorrectionIdentity(row:LiveMonthly,overrides:MonthlyOverride[]){
 const currentKey=monthlyRowKey(row),override=overrides.find(item=>monthlyRowKey(item.row)===currentKey);
 return {key:currentKey,auditKey:override?.key??currentKey,sourceMonth:override?.sourceMonth??row.month};
}
