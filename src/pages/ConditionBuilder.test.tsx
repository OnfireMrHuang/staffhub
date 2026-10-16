import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { conditionFieldOptions, type Condition, type ConditionGroup } from '../compensation-rules';
import ConditionBuilder, { newCondition, withConditionDateFunction } from './ConditionBuilder';
import { conditionEvidenceText, conditionEvidenceValueLabel } from './Payroll';

const group = (...children: ConditionGroup['children']): ConditionGroup => ({kind:'group', operator:'and', children});
const htmlFor = (condition: Condition, readOnly = false) => renderToStaticMarkup(<ConditionBuilder value={group(condition)} onChange={() => {}} label="保薪条件" readOnly={readOnly}/>);
const optionsFor = (html: string, label: string) => html.match(new RegExp(`<select[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1] ?? '';

it('only offers date fields for date-to-date comparisons', () => {
 const html = htmlFor({kind:'condition', field:'employee.joined', operator:'lte', compareField:'context.referenceDate'});
 const options = optionsFor(html, '保薪条件1对比字段');
 expect(options).toContain('employee.joined');
 expect(options).toContain('room.openedOn');
 expect(options).toContain('context.referenceDate');
 expect(options).not.toContain('monthly.month');
 expect(options).not.toContain('monthly.spend');
 expect(html).toContain('不处理（日期）');
 expect(html).not.toContain('type="date"');
 expect(html).not.toContain('最近 N 个月内');
});

it.each(['year','month'] as const)('offers only numeric comparison fields after extracting %s', transform => {
 const html = htmlFor({kind:'condition', field:'employee.joined', transform, operator:'eq', compareField:`monthly.${transform}`});
 const options = optionsFor(html, '保薪条件1对比字段');
 for (const field of ['monthly.year','monthly.month','monthly.spend']) expect(options).toContain(field);
 for (const field of ['employee.joined','room.openedOn','context.referenceDate','employee.name','employee.nonCompeteSigned']) expect(options).not.toContain(field);
 expect(html).not.toContain('aria-label="保薪条件1条件值"');
});

it('starts new date fields in field comparison mode and clears stale operands when the function changes', () => {
 const date = conditionFieldOptions.find(field => field.field === 'employee.joined')!;
 const condition = newCondition([date]);
 expect(condition).toEqual({kind:'condition', field:date.field, operator:'eq', compareField:'context.referenceDate'});
 const extracted = withConditionDateFunction({...condition, operator:'gte'}, 'month');
 expect(extracted).toEqual({kind:'condition', field:date.field, operator:'gte', transform:'month', compareField:'monthly.month'});
 expect(withConditionDateFunction(extracted, 'year').compareField).toBe('monthly.year');
 expect(withConditionDateFunction(extracted)).toEqual({...condition, operator:'gte'});
 const legacy: Condition = {kind:'condition', field:date.field, operator:'withinMonths', value:3};
 expect(withConditionDateFunction(legacy, 'year')).toEqual({kind:'condition', field:date.field, operator:'eq', transform:'year', compareField:'monthly.year'});
 expect(legacy.value).toBe(3);
});

it('preserves only the existing legacy date mode, including in a readonly rule', () => {
 const relative = htmlFor({kind:'condition', field:'employee.joined', operator:'withinMonths', value:3}, true);
 expect(relative).toContain('最近 N 个月内（已有）');
 expect(relative).toContain('最近月数');
 expect(relative).toContain('value="3"');
 expect(relative).toContain('disabled=""');
 expect(relative).not.toContain('按固定日期比较（已有）');
 const literal = htmlFor({kind:'condition', field:'room.openedOn', operator:'lt', value:'2026-01-01'});
 expect(literal).toContain('按固定日期比较（已有）');
 expect(literal).toContain('type="date"');
 expect(literal).not.toContain('最近 N 个月内（已有）');
});

describe('condition evidence', () => {
 it('labels transformed operands, comparisons and their recorded values', () => {
  const text = conditionEvidenceText(group(
   {kind:'condition', field:'employee.joined', transform:'month', operator:'eq', compareField:'monthly.month'},
   {kind:'group', operator:'or', children:[
    {kind:'condition', field:'employee.joined', transform:'year', operator:'eq', compareField:'monthly.year'},
    {kind:'condition', field:'room.openedOn', operator:'lte', compareField:'context.referenceDate'},
   ]},
  ));
  expect(text).toContain('提取月份（入职日期） = 月度汇总月份');
  expect(text).toContain('提取年份（入职日期） = 月度汇总年份');
  expect(text).toContain('直播间开播日期 ≤ 核算基准日（月末）');
  expect(text).not.toContain('undefined');
  expect(conditionEvidenceValueLabel('month(employee.joined)')).toBe('提取月份（入职日期）');
  expect(conditionEvidenceValueLabel('year(room.openedOn)')).toBe('提取年份（直播间开播日期）');
  expect(conditionEvidenceText(group({kind:'condition', field:'employee.nonCompeteSigned', operator:'eq', value:false}))).toContain('已签竞业协议 = 否');
 });
});
