import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { conditionFieldOptions, type Condition, type ConditionGroup } from '../compensation-rules';
import ConditionBuilder, { newCondition, withConditionDateFunction, withConditionComparisonKind, withCalendarMonthCondition } from './ConditionBuilder';
import { conditionEvidenceText, conditionEvidenceValueLabel } from './Payroll';

const group = (...children: ConditionGroup['children']): ConditionGroup => ({kind:'group', operator:'and', children});
const htmlFor = (condition: Condition, readOnly = false) => renderToStaticMarkup(<ConditionBuilder value={group(condition)} onChange={() => {}} label="保薪条件" readOnly={readOnly}/>);
const optionsFor = (html: string, label: string) => html.match(new RegExp(`<select[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1] ?? '';

it('adds a condition directly without a preset menu',()=>{
 const html=renderToStaticMarkup(<ConditionBuilder value={group()} onChange={()=>{}} label="保薪条件"/>);
 expect(html).toContain('aria-label="保薪条件添加条件"');
 expect(html).not.toContain('aria-haspopup');
 expect(html).not.toContain('新主播');
 expect(html).not.toContain('新直播间');
});

it('renders the before-month mode and resets to typed comparison when switching to a function',()=>{
 const condition:Condition={kind:'condition',field:'employee.joined',operator:'beforeCalendarMonths',value:4};
 const html=htmlFor(condition);
 expect(optionsFor(html,'保薪条件1日期判断')).toContain('value="before-calendar-months" selected=""');
 expect(html).toContain('aria-label="保薪条件1月数"');
 expect(html).not.toContain('aria-label="保薪条件1对比字段"');
 expect(withConditionDateFunction(condition,'month')).toEqual({kind:'condition',field:'employee.joined',operator:'eq',transform:'month',compareField:'monthly.month'});
 expect(conditionEvidenceText(group(condition))).toBe('入职日期在过去4个月之前');
});

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
 expect(optionsFor(html, '保薪条件1日期判断')).toContain('时间函数');
 expect(optionsFor(html, '保薪条件1时间函数')).toContain('不处理（日期）');
});

describe('past month conditions',()=>{
 it.each(['employee.joined','room.openedOn'])('shows only a month count for the simple %s predicate',field=>{
  const condition:Condition={kind:'condition',field,operator:'withinCalendarMonths',value:3};
  const html=htmlFor(condition);
  expect(html).not.toContain('新主播');
  expect(html).not.toContain('新直播间');
  expect(html).toContain('在过去 N 个月内');
  expect(html).toContain('过去 N 个月之前');
  expect(html).not.toContain('最近 N 个自然月');
  expect(html).toContain('aria-label="保薪条件1月数"');
  expect(html).not.toContain('aria-label="保薪条件1时间函数"');
  expect(html).not.toContain('侧运算');
  expect(html).not.toContain('aria-label="保薪条件1对比字段"');
  const modes = optionsFor(html, '保薪条件1日期判断');
  expect(modes).toContain('value="calendar-months"');
  expect(modes).toContain('value="before-calendar-months"');
  expect(modes).toContain('value="function"');
  expect(modes).not.toContain('value="year"');
  expect(modes).not.toContain('value="month"');
  expect(htmlFor(condition,true)).toContain('disabled=""');
 });
 it('clears arithmetic and comparison operands when using the simple calendar predicate',()=>{
  const previous:Condition={kind:'condition',field:'employee.joined',transform:'month',adjustment:{operator:'add',value:3},operator:'gte',compareField:'monthly.month',compareAdjustment:{operator:'subtract',value:2}};
  const next=withCalendarMonthCondition(previous);
  expect(next).toEqual({kind:'condition',field:'employee.joined',operator:'withinCalendarMonths',value:3});
  expect(withConditionDateFunction(next,'year')).toEqual({kind:'condition',field:'employee.joined',operator:'eq',transform:'year',compareField:'monthly.year'});
 });
 it('describes the business condition and actual window start in frozen evidence',()=>{
  expect(conditionEvidenceText(group({kind:'condition',field:'room.openedOn',operator:'withinCalendarMonths',value:4}))).toBe('直播间开播日期在过去4个月内（含核算月）');
  expect(conditionEvidenceText(group({kind:'condition',field:'employee.joined',operator:'withinCalendarMonths',value:3}))).toBe('入职日期在过去3个月内（含核算月）');
  expect(conditionEvidenceValueLabel('calendarWindowStart(3)')).toBe('过去3个月的起始日');
 });
});

it.each(['year','month'] as const)('offers only numeric comparison fields after extracting %s', transform => {
 const html = htmlFor({kind:'condition', field:'employee.joined', transform, operator:'eq', compareField:`monthly.${transform}`});
 const options = optionsFor(html, '保薪条件1对比字段');
 for (const field of ['monthly.year','monthly.month','monthly.spend']) expect(options).toContain(field);
 for (const field of ['employee.joined','room.openedOn','context.referenceDate','employee.name','employee.nonCompeteSigned']) expect(options).not.toContain(field);
 expect(html).not.toContain('aria-label="保薪条件1条件值"');
 expect(optionsFor(html, '保薪条件1时间函数')).toContain(`value="${transform}" selected=""`);
 expect(optionsFor(html, '保薪条件1日期判断')).toContain('value="function" selected=""');
 expect(html).not.toContain('数值运算');
});

it('starts new date fields with a calendar window and clears stale operands when the function changes', () => {
 const date = conditionFieldOptions.find(field => field.field === 'employee.joined')!;
 const condition = newCondition([date]);
 expect(condition).toEqual({kind:'condition', field:date.field, operator:'withinCalendarMonths', value:3});
 const extracted = withConditionDateFunction({...condition, operator:'gte'}, 'month');
 expect(extracted).toEqual({kind:'condition', field:date.field, operator:'gte', transform:'month', compareField:'monthly.month'});
 expect(withConditionDateFunction(extracted, 'year').compareField).toBe('monthly.year');
 expect(withConditionDateFunction(extracted)).toEqual({kind:'condition',field:date.field,operator:'gte',compareField:'context.referenceDate'});
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


describe('numeric condition operands', () => {
 it('offers numeric field comparisons without arithmetic controls', () => {
  const html = htmlFor({kind:'condition', field:'monthly.month', operator:'gte', compareField:'monthly.year'});
  expect(optionsFor(html, '保薪条件1对比方式')).toContain('固定数值');
  expect(optionsFor(html, '保薪条件1对比方式')).toContain('数值字段');
  expect(optionsFor(html, '保薪条件1对比字段')).toContain('monthly.month');
  expect(optionsFor(html, '保薪条件1对比字段')).not.toContain('employee.joined');
  expect(html).not.toContain('数值运算');
  expect(html).not.toContain('侧运算');
 });
 it('keeps original numeric fixed comparisons without arithmetic', () => {
  const html = htmlFor({kind:'condition', field:'monthly.month', operator:'gte', value:3});
  expect(html).toContain('aria-label="保薪条件1条件值"');
  expect(html).not.toContain('aria-label="保薪条件1左侧运算"');
  expect(html).not.toContain('aria-label="保薪条件1右侧运算"');
 });
 it('does not show arithmetic for dates, booleans or strings, including legacy months', () => {
  const conditions:Condition[] = [
   {kind:'condition',field:'employee.joined',operator:'lte',compareField:'context.referenceDate'},
   {kind:'condition',field:'employee.joined',operator:'withinMonths',value:3},
   {kind:'condition',field:'employee.nonCompeteSigned',operator:'eq',value:false},
   {kind:'condition',field:'employee.name',operator:'eq',value:'测试'},
  ];
  for(const condition of conditions) expect(htmlFor(condition)).not.toContain('侧运算');
 });
 it('keeps extracted numbers field-only without arithmetic', () => {
  const html = htmlFor({kind:'condition',field:'employee.joined',transform:'month',operator:'lte',compareField:'monthly.month'});
  expect(html).toContain('aria-label="保薪条件1时间函数"');
  expect(html).not.toContain('侧运算');
  expect(html).not.toContain('aria-label="保薪条件1对比方式"');
 });
 it('clears all stale arithmetic and operands when switching numeric comparison mode', () => {
  const condition = {kind:'condition',field:'monthly.month',operator:'gte',compareField:'monthly.year',adjustment:{operator:'add',value:3},compareAdjustment:{operator:'subtract',value:1}} as Condition;
  const fixed = withConditionComparisonKind(condition, 'value');
  expect(fixed).toEqual({kind:'condition',field:'monthly.month',operator:'gte',value:0});
  const field = withConditionComparisonKind(fixed, 'field');
  expect(field.compareField).toBeTruthy();
  expect(field).not.toHaveProperty('value');
  expect(field).not.toHaveProperty('compareAdjustment');
  expect(withConditionDateFunction({...condition,field:'employee.joined',transform:'month'})).toEqual({kind:'condition',field:'employee.joined',operator:'gte',compareField:'context.referenceDate'});
 });
 it('shows existing arithmetic as a complete readonly summary with an explicit reset action', () => {
  const condition:Condition = {kind:'condition',field:'employee.joined',transform:'month',operator:'gte',compareField:'monthly.month',adjustment:{operator:'add',value:3},compareAdjustment:{operator:'subtract',value:1}};
  const html = htmlFor(condition);
  expect(html).toContain('(提取月份（入职日期） + 3) ≥ (月度汇总月份 − 1)');
  expect(html).toContain('重新配置');
  expect(html).not.toContain('aria-label="保薪条件1字段"');
  expect(html).not.toContain('侧运算');
  expect(htmlFor(condition,true)).not.toContain('重新配置');
  expect(condition.adjustment?.value).toBe(3);
 });
 it('labels arithmetic after transformations and on the comparison field in evidence', () => {
  const condition = {kind:'condition',field:'employee.joined',transform:'month',operator:'gte',compareField:'monthly.month',adjustment:{operator:'add',value:3},compareAdjustment:{operator:'subtract',value:1}} as Condition;
  expect(conditionEvidenceText(group(condition))).toBe('(提取月份（入职日期） + 3) ≥ (月度汇总月份 − 1)');
  expect(conditionEvidenceValueLabel('add(month(employee.joined),3)')).toBe('(提取月份（入职日期） + 3)');
  expect(conditionEvidenceValueLabel('subtract(monthly.month,1)')).toBe('(月度汇总月份 − 1)');
 });
});
