import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../components';
import {
 conditionComparisonFields, conditionFieldOptions, type Condition, type ConditionGroup,
 type DateTransform, type FieldOption,
} from '../compensation-rules';

const comparisons: [Condition['operator'], string][] = [
 ['eq','等于'], ['ne','不等于'], ['gt','大于'], ['gte','大于等于'], ['lt','小于'], ['lte','小于等于'],
];

/** Changing a date function starts a typed field comparison, removing legacy literal operands. */
export function withConditionDateFunction(condition: Condition, transform?: DateTransform, fields = conditionFieldOptions): Condition {
 const next: Condition = {
  kind:'condition', field:condition.field, operator:condition.operator === 'withinMonths' ? 'eq' : condition.operator,
  ...(transform ? {transform} : {}),
 };
 const candidates = conditionComparisonFields(next, fields);
 const preferred = transform ? `monthly.${transform}` : 'context.referenceDate';
 return {...next, compareField:candidates.find(field => field.field === preferred)?.field ?? candidates.find(field => field.field !== next.field)?.field ?? candidates[0]?.field ?? ''};
}

export function newCondition(options: FieldOption[] = conditionFieldOptions, availableFields = conditionFieldOptions): Condition {
 const option = options[0];
 const condition: Condition = {kind:'condition', field:option.field, operator:'eq'};
 return option.type === 'date' ? withConditionDateFunction(condition, undefined, availableFields)
  : {...condition, value:option.type === 'boolean' ? false : option.type === 'number' ? 0 : ''};
}

interface ConditionBuilderProps {
 value: ConditionGroup;
 onChange: (value: ConditionGroup) => void;
 readOnly?: boolean;
 fields?: FieldOption[];
 label?: string;
}

export default function ConditionBuilder({value,onChange,readOnly=false,fields=conditionFieldOptions,label='筛选条件'}: ConditionBuilderProps) {
 const update = (index: number, child: Condition | ConditionGroup) => onChange({...value, children:value.children.map((item,i) => i === index ? child : item)});
 return <fieldset className="condition-builder" disabled={readOnly}>
  <legend>{label}</legend>
  <div className="inline condition-group-head">
   <select aria-label={`${label}组合方式`} value={value.operator} onChange={event => onChange({...value, operator:event.target.value as ConditionGroup['operator']})}>
    <option value="and">全部满足（AND）</option><option value="or">任一满足（OR）</option>
   </select>
   <span className="spacer" />
   {!readOnly && <>
    <Button onClick={() => onChange({...value, children:[...value.children, newCondition(fields, fields)]})}><Plus size={13}/>添加条件</Button>
    <Button onClick={() => onChange({...value, children:[...value.children, {kind:'group', operator:'and', children:[newCondition(fields, fields)]}]})}><Plus size={13}/>添加条件组</Button>
   </>}
  </div>
  {!value.children.length && <p className="caption">尚未配置条件</p>}
  {value.children.map((child,index) => <div className="condition-child" key={index}>
   {child.kind === 'group'
    ? <ConditionBuilder value={child} onChange={next => update(index,next)} readOnly={readOnly} fields={fields} label={`${label}组${index+1}`}/>
    : <ConditionRow condition={child} fields={fields} label={`${label}${index+1}`} onChange={next => update(index,next)}/>}
   {!readOnly && <button className="icon-button" aria-label={`删除${label}${index+1}`} onClick={() => onChange({...value, children:value.children.filter((_,i) => i !== index)})}><Trash2 size={14}/></button>}
  </div>)}
 </fieldset>;
}

function ConditionRow({condition,fields,label,onChange}: {condition:Condition; fields:FieldOption[]; label:string; onChange:(value:Condition) => void}) {
 const type = fields.find(field => field.field === condition.field)?.type ?? 'string';
 const isDate = type === 'date';
 const legacyDate = isDate && condition.compareField === undefined && condition.transform === undefined;
 const legacyMonths = legacyDate && condition.operator === 'withinMonths';
 const operators = legacyMonths ? [['withinMonths','最近 N 个月内'] as [Condition['operator'],string]]
  : type === 'boolean' || type === 'string' ? comparisons.slice(0,2) : comparisons;
 const comparisonFields = isDate && !legacyDate ? conditionComparisonFields(condition, fields) : [];
 const dateMode = legacyDate ? legacyMonths ? 'legacy-months' : 'legacy-literal' : condition.transform ?? 'none';
 return <div className={`condition-row${isDate ? ' condition-row-date' : ''}`}>
  <label>字段
   <select aria-label={`${label}字段`} value={condition.field} onChange={event => {
    const next = fields.find(field => field.field === event.target.value);
    if (next) onChange(newCondition([next], fields));
   }}>{fields.map(field => <option key={field.field} value={field.field}>{field.label}</option>)}</select>
  </label>
  {isDate && <label>时间函数
   <select aria-label={`${label}时间函数`} value={dateMode} onChange={event => {
    const selected = event.target.value;
    if (selected === 'none' || selected === 'year' || selected === 'month') onChange(withConditionDateFunction(condition, selected === 'none' ? undefined : selected, fields));
   }}>
    <option value="none">不处理（日期）</option><option value="year">提取年份</option><option value="month">提取月份</option>
    {legacyDate && <option value={dateMode}>{legacyMonths ? '最近 N 个月内（已有）' : '按固定日期比较（已有）'}</option>}
   </select>
  </label>}
  <label>比较
   <select aria-label={`${label}比较`} value={condition.operator} onChange={event => onChange({...condition, operator:event.target.value as Condition['operator']})}>
    {operators.map(([id,name]) => <option value={id} key={id}>{name}</option>)}
   </select>
  </label>
  {isDate && !legacyDate ? <label>对比字段
   <select aria-label={`${label}对比字段`} value={condition.compareField ?? ''} onChange={event => onChange({...condition, compareField:event.target.value})}>
    {!comparisonFields.some(field => field.field === condition.compareField) && <option value="">请选择{condition.transform ? '数值' : '日期'}字段</option>}
    {comparisonFields.map(field => <option key={field.field} value={field.field}>{field.label}</option>)}
   </select>
  </label> : <label>{legacyMonths ? '最近月数' : '条件值'}
   {type === 'boolean'
    ? <select aria-label={`${label}条件值`} value={String(condition.value)} onChange={event => onChange({...condition, value:event.target.value === 'true'})}><option value="true">已签署 / 是</option><option value="false">未签署 / 否</option></select>
    : <input aria-label={`${label}条件值`} type={type === 'number' || legacyMonths ? 'number' : isDate ? 'date' : 'text'} min={legacyMonths ? 0 : undefined} step={legacyMonths ? 1 : 'any'}
      value={condition.value === undefined || typeof condition.value === 'number' && !Number.isFinite(condition.value) ? '' : String(condition.value)}
      onChange={event => onChange({...condition, value:type === 'number' || legacyMonths ? event.target.value === '' ? NaN : Number(event.target.value) : event.target.value})}/>}
  </label>}
 </div>;
}
