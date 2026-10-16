import { conditionFieldOptions, type ConditionGroup } from './compensation-rules';

export function conditionEvidenceValueLabel(field:string):string {
 const windowStart = /^calendarWindowStart\((\d+)\)$/.exec(field);
 if(windowStart) return `过去${windowStart[1]}个月的起始日`;
 const adjusted = /^(add|subtract)\((.+),([^,]+)\)$/.exec(field);
 if (adjusted) return `(${conditionEvidenceValueLabel(adjusted[2])} ${adjusted[1] === 'add' ? '+' : '−'} ${adjusted[3]})`;
 const literal = /^literal\((.+)\)$/.exec(field);
 if (literal) return literal[1];
 const transformed = /^(year|month)\((.+)\)$/.exec(field);
 if (transformed) return `${transformed[1] === 'year' ? '提取年份' : '提取月份'}（${conditionEvidenceValueLabel(transformed[2])}）`;
 return conditionFieldOptions.find(option => option.field === field)?.label ?? field;
}
export function conditionEvidenceText(group:ConditionGroup):string {
 return group.children.map(child => {
  if (child.kind === 'group') return `(${conditionEvidenceText(child)})`;
  if(child.operator==='withinCalendarMonths' || child.operator==='beforeCalendarMonths') {
   return `${conditionEvidenceValueLabel(child.field)}在过去${child.value}个月${child.operator==='beforeCalendarMonths'?'之前':'内（含核算月）'}`;
  }
  const leftField = child.transform ? `${child.transform}(${child.field})` : child.field;
  const left = conditionEvidenceValueLabel(child.adjustment ? `${child.adjustment.operator}(${leftField},${child.adjustment.value})` : leftField);
  const operator = {eq:'=',ne:'≠',gt:'>',gte:'≥',lt:'<',lte:'≤',withinMonths:'最近月数 ≤'}[child.operator];
  const rightValue = child.compareField !== undefined ? conditionEvidenceValueLabel(child.compareField)
   : typeof child.value === 'boolean' ? child.value ? '是' : '否' : child.value ?? '未设置';
  const right = child.compareAdjustment ? `(${rightValue} ${child.compareAdjustment.operator === 'add' ? '+' : '−'} ${child.compareAdjustment.value})` : rightValue;
  return `${left} ${operator} ${right}`;
 }).join(group.operator === 'and' ? ' 且 ' : ' 或 ');
}
