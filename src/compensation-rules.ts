import type { Band, Department, Employee, Salary } from './domain';
import type { LiveMonthly } from './live-domain';
import type { LiveRoom } from './operations-domain';

/** `employees` is retained only for frozen historical rule/task compatibility. Current definitions use global or rooms. */
export type Scope = 'global' | 'rooms' | 'employees';
export type CalculationType = 'allowance' | 'premium' | 'hourly';
export type NewDuration = 'hours' | 'nightHours' | 'earlyHours' | 'regularHours';
export type CompensationMetric = NewDuration | 'spend' | 'premium' | 'regularPremium' | 'nightPremium' | 'earlyPremium' | 'regularSpend' | 'adCost' | 'policyCost' | 'spendRank' | 'roi' | 'hourlySpend' | 'nightSpend' | 'earlySpend' | 'roiRank' | 'sessions' | 'nightSessions' | 'earlySessions' | 'waitingSalaryDays' | 'past3MonthsAvgHourlyRate';
export type DateTransform = 'year'|'month';
export type NumericAdjustment = {operator:'add'|'subtract';value:number};
/** withinMonths retains historical rolling dates; calendar predicates use N months including the calculation month. */
export type Condition = {kind:'condition'; field:string; operator:'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'withinMonths'|'withinCalendarMonths'|'beforeCalendarMonths'; transform?:DateTransform; adjustment?:NumericAdjustment; compareField?:string; compareAdjustment?:NumericAdjustment; value?:string|number|boolean};
export type ConditionGroup = {kind:'group'; operator:'and'|'or'; children:(Condition|ConditionGroup)[]};
export interface NewRuleBand extends Band {keyType:'exact'|'range'|'related'; relatedField?:CompensationMetric}
export interface HourlyItem {id:string; name:string; kind:'metric'|'special'|'guarantee'; field?:string; bands?:NewRuleBand[]; rate?:number; rateField?:string; condition?:ConditionGroup}
export type CountMetric = 'nightSessions'|'earlySessions'|'waitingSalaryDays';
export type PremiumField = 'premium'|'nightPremium'|'earlyPremium'|'regularPremium';
export interface PremiumItem {id:string;name:string;field:PremiumField;coefficient:number}
export interface LegacyPremiumConfig {normalField:'regularPremium';earlyField:'earlyPremium';coefficient:number;condition:ConditionGroup}
export interface PremiumItemConfig {items:PremiumItem[]}
export interface CompensationRule {
  id:string; name:string; version:number; status:'草稿'|'已发布'; scope:Scope; roomIds:string[]; employeeCondition?:ConditionGroup; type:CalculationType;
  definitionVersion?:2; deletedAt?:string; roomRuleSetId?:string;
  allowance?:{field:CountMetric;amount:number};
  premium?:LegacyPremiumConfig|PremiumItemConfig;
  hourly?:{duration:NewDuration; kind?:HourlyItem['kind']; items:HourlyItem[]; formula:{mode:'additions';itemIds:string[]}|{mode:'guarantee';itemId:string}};
}
/** Current draft and published room rules reserve their selected rooms. */
export function compensationRoomOwners(rules:CompensationRule[],excludeRuleId:string):Map<string,CompensationRule> {
  const owners=new Map<string,CompensationRule>();
  const selected=rules.find(rule=>rule.scope==='rooms' && !rule.deletedAt && rule.id===excludeRuleId);
  const excludedSetId=selected?.roomRuleSetId ?? (rules.some(rule=>rule.scope==='rooms' && !rule.deletedAt && rule.roomRuleSetId===excludeRuleId)?excludeRuleId:undefined);
  for(const rule of rules) if(rule.scope==='rooms' && !rule.deletedAt && rule.id!==excludeRuleId && (!excludedSetId || rule.roomRuleSetId!==excludedSetId)) {
    for(const roomId of rule.roomIds) if(!owners.has(roomId)) owners.set(roomId,rule);
  }
  return owners;
}
export function validateCompensationRoomOwnership(rule:CompensationRule,rules:CompensationRule[]):void {
  if(rule.scope!=='rooms') return;
  const previous=rules.find(item=>item.id===rule.id);
  if(!previous && rules.some(item=>item.roomRuleSetId===rule.id)) throw new Error('子规则 ID 不能占用现有规则集 ID');
  if(previous && previous.roomRuleSetId!==rule.roomRuleSetId) throw new Error('规则集归属不可通过子规则修改');
  const owners=compensationRoomOwners(rules,rule.id);
  for(const roomId of rule.roomIds) {
    const owner=owners.get(roomId);
    if(owner) throw new Error(`直播间 ${roomId} 已被规则「${owner.name}」占用，请调整适用直播间`);
  }
}
export interface FieldOption {field:string; label:string; type:'number'|'string'|'boolean'|'date'}
export const durationOptions: (FieldOption & {field:NewDuration})[] = [
  {field:'hours',label:'总直播时长',type:'number'}, {field:'nightHours',label:'夜班直播时长',type:'number'},
  {field:'earlyHours',label:'早班直播时长',type:'number'}, {field:'regularHours',label:'正常直播时长',type:'number'},
];
export const compensationMetricOptions: (FieldOption & {field:CompensationMetric})[] = [
  ...durationOptions,
  ...([['spend','总消耗'],['premium','有效总保费'],['regularPremium','正常保费'],['nightPremium','夜班保费'],['regularSpend','正常消耗'],['adCost','AD成本（待定义）'],['policyCost','保单成本（待定义）'],['spendRank','消耗排名'],['earlyPremium','早班保费'],['roi','有效 ROI'],['hourlySpend','时耗'],['nightSpend','夜班消耗'],['earlySpend','早班消耗'],['roiRank','有效 ROI 排名'],['sessions','直播场次'],['nightSessions','夜班场次'],['earlySessions','早班场次'],['waitingSalaryDays','等待薪资天数'],['past3MonthsAvgHourlyRate','过去3个月的平均时薪']] as [CompensationMetric,string][]).map(([field,label]) => ({field,label,type:'number' as const})),
];
/** Guarantee variables read the original monthly table, before premium coefficients and ROI reranking. */
export const guaranteeRateFieldOptions:FieldOption[]=[
  {field:'year',label:'年份',type:'number'},{field:'month',label:'月份',type:'number'},
  ...compensationMetricOptions.filter(option=>option.field!=='sessions').map(option=>({...option,label:option.field==='premium'?'总保费':option.field==='roi'?'ROI':option.field==='roiRank'?'ROI排名':option.label})),
];
export const allowanceCountOptions=compensationMetricOptions.filter(option=>['nightSessions','earlySessions','waitingSalaryDays'].includes(option.field));
export const premiumFieldOptions:FieldOption[]=[{field:'premium',label:'总保费',type:'number'},{field:'nightPremium',label:'夜班保费',type:'number'},{field:'earlyPremium',label:'早班保费',type:'number'},{field:'regularPremium',label:'正常保费',type:'number'}];
export const conditionFieldOptions: FieldOption[] = [
  {field:'employee.id',label:'员工 ID',type:'string'}, {field:'employee.name',label:'员工姓名',type:'string'},
  {field:'employee.departmentId',label:'员工部门',type:'string'}, {field:'employee.position',label:'员工岗位',type:'string'},
  {field:'employee.status',label:'员工状态',type:'string'}, {field:'employee.joined',label:'入职日期',type:'date'},
  {field:'employee.nonCompeteSigned',label:'已签竞业协议',type:'boolean'}, {field:'room.id',label:'直播间 ID',type:'string'},
  {field:'room.name',label:'直播间名称',type:'string'}, {field:'room.openedOn',label:'直播间开播日期',type:'date'},
  {field:'context.referenceDate',label:'核算基准日（月末）',type:'date'},
  {field:'monthly.year',label:'月度汇总年份',type:'number'}, {field:'monthly.month',label:'月度汇总月份',type:'number'},
  ...compensationMetricOptions.map(option => ({...option,field:`monthly.${option.field}`})),
];
export function conditionResultType(condition:Pick<Condition,'field'|'transform'>,fields:FieldOption[]=conditionFieldOptions):FieldOption['type']|undefined {
  const type=fields.find(option=>option.field===condition.field)?.type;
  if(condition.transform===undefined) return type;
  return type==='date' && ['year','month'].includes(condition.transform)?'number':undefined;
}
export function conditionComparisonFields(condition:Pick<Condition,'field'|'transform'>,fields:FieldOption[]=conditionFieldOptions):FieldOption[] {
  const type=conditionResultType(condition,fields);
  return type===undefined?[]:fields.filter(option=>option.type===type);
}
export interface ConditionEvidence {ruleId:string;itemId?:string;condition:ConditionGroup;matched:boolean;values:Record<string,string|number|boolean>}
export interface HourlyItemCalculation {ruleId:string;itemId:string;name:string;kind:HourlyItem['kind'];rate:number;matched:boolean;field?:string;value?:number}
export interface DurationGroupCalculation {scope?:Scope;duration:NewDuration;hours:number;guarantee:number;additions:number;rate:number;amount:number;items:HourlyItemCalculation[]}
export interface PremiumRuleCalculation {ruleId:string;amount:number;selected:boolean;items:(PremiumItem & {value:number;amount:number})[]}
export interface ScopeCalculation {allowance:number;premium:number;guarantee:number;additions:number;matchedRuleIds:string[]}
export interface RuleCalculation {ruleId:string;scope:Scope;type:CalculationType;mode?:'guarantee'|'additions';rate?:number;duration?:NewDuration;hours?:number;amount:number;coefficient?:number;matched?:boolean}
export interface PayrollRowCalculation {
  employeeId:string;employeeName:string;roomId:string;roomName:string;month:string;matchedRuleIds:string[];
  statistics?:LiveMonthly;scopes?:Record<Scope,ScopeCalculation>;guarantee?:number;additions?:number;ruleCalculations?:RuleCalculation[];
  allowance:number;allowanceItems:{ruleId:string;field?:CountMetric;sessions:number;rate:number;amount:number}[];
  premium:{before:number;regular:number|null;early:number|null;coefficient:number;after:number;roiBefore:number|null;roiAfter:number|null;rank:number|null;candidates?:PremiumRuleCalculation[]};
  durationGroups:DurationGroupCalculation[];conditions:ConditionEvidence[];total:number;
}
export interface CompensationResult {settlementVersion?:2;salaries:Salary[];rows:PayrollRowCalculation[];referenceDate:string}
export function blankConditionGroup():ConditionGroup {return {kind:'group',operator:'and',children:[]};}
const nonnegative = (value:unknown):value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function validNumber(value:unknown,label:string):number {
  if (!nonnegative(value)) throw new Error(`${label} 数据缺失、为负或非有限数值`);
  return value;
}
function finite(value:number,label:string):number {return validNumber(value,`${label}（计算溢出或无效）`);}
const money = (value:number):number => {
  // Shift the decimal representation so binary multiplication does not round 1.005 down to 1.00.
  const [significand,exponent='0']=finite(value,'金额').toString().split('e');
  const shifted=finite(Number(`${significand}e${Number(exponent)+2}`),'金额');
  const half=Math.floor(shifted)+0.5;
  // A multiplication such as 0.05 × 0.7 may land one floating-point step below half a cent.
  const corrected=!Number.isInteger(shifted)&&shifted<half&&half-shifted<=Number.EPSILON*shifted?half:shifted;
  return finite(Math.round(corrected)/100,'金额');
};
const isMetric = (field:unknown):field is CompensationMetric => compensationMetricOptions.some(option => option.field === field);
const isDuration = (field:unknown):field is NewDuration => durationOptions.some(option => option.field === field);
function dateNumber(value:unknown,label:string):number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4))<1) throw new Error(`${label} 日期缺失或无效`);
  const timestamp=Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10)!==value) throw new Error(`${label} 日期无效`);
  return timestamp;
}
export function referenceDateForMonth(month:string):string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('核算月份无效');
  const [year,m]=month.split('-').map(Number);
  if (year < 1) throw new Error('核算月份无效');
  // ISO parsing avoids JavaScript's special handling of years 00–99 in Date.UTC.
  const first = new Date(`${month}-01T00:00:00Z`);
  first.setUTCMonth(m); first.setUTCDate(0);
  return first.toISOString().slice(0,10);
}
function validateNumericAdjustment(adjustment:unknown,resultType:FieldOption['type']):void {
  if(adjustment===undefined) return;
  if(resultType!=='number') throw new Error('加减运算仅支持数值字段或时间函数处理后的数值');
  if(!adjustment || typeof adjustment!=='object' || Array.isArray(adjustment)) throw new Error('数值运算配置无效');
  const config=adjustment as Record<string,unknown>;
  if(Object.keys(config).some(key=>!['operator','value'].includes(key)) || !['add','subtract'].includes(config.operator as string) || !nonnegative(config.value)) throw new Error('数值运算须选择加或减，并填写有限非负数值');
}
function validateCondition(group:ConditionGroup,allowedFields?:Set<string>,seen=new Set<unknown>(),depth=0):void {
  if (!group || group.kind!=='group' || !['and','or'].includes(group.operator) || !Array.isArray(group.children) || !group.children.length || depth>30 || seen.has(group)) throw new Error('条件必须为非空有效 AND/OR 条件组');
  seen.add(group);
  for (const child of group.children) {
    if (child?.kind==='group') {validateCondition(child,allowedFields,seen,depth+1);continue;}
    if (!child || child.kind!=='condition') throw new Error('条件类型无效');
    const option=conditionFieldOptions.find(option=>option.field===child.field);
    if (!option || (allowedFields && !allowedFields.has(child.field))) throw new Error('条件字段无效或不适用于此规则');
    if (!['eq','ne','gt','gte','lt','lte','withinMonths','withinCalendarMonths','beforeCalendarMonths'].includes(child.operator)) throw new Error('条件运算符无效');
    if(child.operator==='withinCalendarMonths' || child.operator==='beforeCalendarMonths') {
      if(option.type!=='date' || child.transform!==undefined || child.adjustment!==undefined || child.compareField!==undefined || child.compareAdjustment!==undefined) throw new Error('月份条件仅支持原始日期字段，不组合时间函数、加减或比较字段');
      if(!Number.isSafeInteger(child.value) || typeof child.value!=='number' || child.value<1) throw new Error('过去月数必须为正整数，且包含核算月');
      continue;
    }
    const resultType=conditionResultType(child);
    if(!resultType) throw new Error('时间函数无效或不适用于此字段');
    validateNumericAdjustment(child.adjustment,resultType);
    validateNumericAdjustment(child.compareAdjustment,resultType);
    if(child.compareField!==undefined) {
      const comparison=conditionFieldOptions.find(option=>option.field===child.compareField);
      if(!comparison || (allowedFields && !allowedFields.has(comparison.field))) throw new Error('比较字段无效或不适用于此规则');
      if(Object.prototype.hasOwnProperty.call(child,'value')) throw new Error('字段比较不能同时设置固定条件值');
      if(comparison.type!==resultType) throw new Error('比较字段类型不一致：日期须比较日期字段，时间函数须比较数值字段');
      if(child.operator==='withinMonths') throw new Error('字段比较不能使用相对月数运算');
      if(!['number','date'].includes(resultType) && !['eq','ne'].includes(child.operator)) throw new Error('文本和布尔条件仅支持等于或不等于');
      continue;
    }
    if(child.transform!==undefined) throw new Error('应用时间函数后必须选择数值比较字段');
    if (child.operator==='withinMonths') {
      if (option.type!=='date' || !Number.isSafeInteger(child.value) || !nonnegative(child.value)) throw new Error('日期月数必须为非负整数');
    } else if (option.type==='date') dateNumber(child.value,option.label);
    else {
      if (typeof child.value!==option.type || (option.type==='number' && !nonnegative(child.value))) throw new Error('条件值类型或数值无效');
      if (option.type!=='number' && !['eq','ne'].includes(child.operator)) throw new Error('文本和布尔条件仅支持等于或不等于');
    }
  }
  seen.delete(group);
}
function contains(value:number,band:NewRuleBand):boolean {
  return band.keyType==='exact' ? value===band.exact : (band.min===undefined || (band.includeMin?value>=band.min:value>band.min)) && (band.max===undefined || (band.includeMax?value<=band.max:value<band.max));
}
const bandField = (item:HourlyItem,band:NewRuleBand):CompensationMetric => band.keyType==='related'?band.relatedField!:item.field as CompensationMetric;
export function validateBands(item:HourlyItem):void {
  if (!Array.isArray(item.bands) || !item.bands.length) throw new Error('指标时薪枚举不能为空');
  for (const band of item.bands) {
    if (!band || !['exact','range','related'].includes(band.keyType) || !nonnegative(band.rate) || [band.min,band.max,band.exact].some(v=>v!==undefined&&!nonnegative(v)) || typeof band.includeMin!=='boolean' || typeof band.includeMax!=='boolean') throw new Error('档位类型、数值或边界无效');
    if (band.keyType==='exact') {
      if (band.exact===undefined || band.min!==undefined || band.max!==undefined || band.relatedField!==undefined) throw new Error('精确档位只允许精确值');
    } else {
      if (band.exact!==undefined || (band.min===undefined && band.max===undefined) || (band.min!==undefined && band.max!==undefined && (band.min>band.max || (band.min===band.max && !(band.includeMin&&band.includeMax))))) throw new Error('档位区间无效');
      if (band.keyType==='related' ? !isMetric(band.relatedField)||band.relatedField===item.field : band.relatedField!==undefined) throw new Error('关联档位字段无效');
    }
  }
  for (let i=0;i<item.bands.length;i++) for(let j=i+1;j<item.bands.length;j++) {
    const a=item.bands[i],b=item.bands[j];
    if (bandField(item,a)!==bandField(item,b)) continue;
    const lo=Math.max(a.keyType==='exact'?a.exact!:a.min??-Infinity,b.keyType==='exact'?b.exact!:b.min??-Infinity);
    const hi=Math.min(a.keyType==='exact'?a.exact!:a.max??Infinity,b.keyType==='exact'?b.exact!:b.max??Infinity);
    if (lo<hi || (lo===hi && contains(lo,a)&&contains(lo,b))) throw new Error('时薪档位范围重叠');
  }
}
export function validateCompensationRule(rule:CompensationRule):void {
  if (!rule || typeof rule.id!=='string' || !rule.id.trim() || typeof rule.name!=='string' || !rule.name.trim()) throw new Error('规则 ID 和名称不能为空');
  if(rule.definitionVersion!==undefined&&rule.definitionVersion!==2) throw new Error('规则定义版本无效');
  if (!Number.isSafeInteger(rule.version)||rule.version<1 || !['草稿','已发布'].includes(rule.status)) throw new Error('规则版本或状态无效');
  if (!['global','rooms','employees'].includes(rule.scope) || !Array.isArray(rule.roomIds) || rule.roomIds.some(id=>typeof id!=='string'||!id.trim()) || new Set(rule.roomIds).size!==rule.roomIds.length) throw new Error('规则范围或直播间集合无效');
  if(rule.roomRuleSetId!==undefined && (typeof rule.roomRuleSetId!=='string' || !rule.roomRuleSetId.trim() || rule.scope!=='rooms')) throw new Error('直播间规则集归属无效');
  if (rule.scope==='rooms' ? !rule.roomIds.length : rule.roomIds.length>0) throw new Error('直播间范围必须选择直播间，其他范围不能限定直播间');
  if (rule.scope==='employees') validateCondition(rule.employeeCondition!,new Set(conditionFieldOptions.filter(option=>option.field.startsWith('employee.')).map(option=>option.field)));
  else if (rule.employeeCondition!==undefined) throw new Error('员工筛选条件仅适用于员工范围');
  if (!['allowance','premium','hourly'].includes(rule.type) || ['allowance','premium','hourly'].some(type=>type!==rule.type && rule[type as CalculationType]!==undefined)) throw new Error('规则类型或配置无效');
  if (rule.type==='allowance') {
    if (!rule.allowance || !allowanceCountOptions.some(option=>option.field===rule.allowance!.field) || !nonnegative(rule.allowance.amount)) throw new Error('补贴必须选择有效计数指标并填写有限非负金额');
  } else if (rule.type==='premium') {
    const config=rule.premium;
    if(config && 'items' in config) {
      if(!Array.isArray(config.items)||!config.items.length) throw new Error('至少添加一个系数项');
      if(new Set(config.items.map(item=>item.id)).size!==config.items.length) throw new Error('系数项 ID 重复');
      for(const item of config.items) if(!item || typeof item.id!=='string'||!item.id.trim() || typeof item.name!=='string'||!item.name.trim() || !premiumFieldOptions.some(option=>option.field===item.field) || !nonnegative(item.coefficient)) throw new Error('系数项名称、保费字段或系数无效');
    } else {
      if (rule.definitionVersion===2 || !config || config.normalField!=='regularPremium' || config.earlyField!=='earlyPremium' || !nonnegative(config.coefficient)) throw new Error('保费字段或系数无效');
      validateCondition(config.condition,new Set(['monthly.earlySessions']));
    }
  } else {
    const config=rule.hourly;
    if (!config || !isDuration(config.duration) || !Array.isArray(config.items)||!config.items.length) throw new Error('时薪必须选择时长和项目');
    if (new Set(config.items.map(item=>item.id)).size!==config.items.length) throw new Error('时薪项目 ID 重复');
    for (const item of config.items) {
      if (!item || typeof item.id!=='string'||!item.id.trim() || typeof item.name!=='string'||!item.name.trim() || !['metric','special','guarantee'].includes(item.kind)) throw new Error('时薪项目类型或名称无效');
      if (item.condition) validateCondition(item.condition);
      if(item.rateField!==undefined && (item.kind!=='guarantee' || !guaranteeRateFieldOptions.some(option=>option.field===item.rateField) || Object.hasOwn(item,'rate'))) throw new Error('保薪变量须选择月度汇总数值字段，且与固定保薪值互斥');
      if (item.kind==='metric') {
        if (!isMetric(item.field) || item.rate!==undefined) throw new Error('指标项目必须选择有效指标');
        validateBands(item);
      } else if ((item.rateField===undefined && !nonnegative(item.rate)) || item.field!==undefined || (item.bands!==undefined && item.bands.length)) throw new Error('特殊加成和保薪项目必须填写有限非负时薪或选择保薪变量');
    }
    if(rule.definitionVersion===2) {
      if(!config.kind || !['metric','special','guarantee'].includes(config.kind) || config.items.some(item=>item.kind!==config.kind)) throw new Error('时薪项目须使用所选计算类型');
      if(config.kind!=='metric' && config.items.length!==1) throw new Error('特殊时段或条件保薪仅配置一项');
      if(config.kind==='guarantee' && !config.items[0].condition) throw new Error('条件保薪必须填写保薪条件');
      if(config.kind==='metric' && config.items.some(item=>item.condition)) throw new Error('统计指标加成仅通过档位判断');
      if(config.kind==='special' && config.items[0].condition) throw new Error('特殊时段加成直接设置金额');
    }
    const formula=config.formula;
    if (!formula || !['additions','guarantee'].includes(formula.mode)) throw new Error('时薪公式无效');
    if (formula.mode==='guarantee') {
      if (!config.items.some(item=>item.id===formula.itemId && item.kind==='guarantee')) throw new Error('保薪公式必须引用一个有效保薪项目');
    } else if (!Array.isArray(formula.itemIds) || !formula.itemIds.length || new Set(formula.itemIds).size!==formula.itemIds.length || formula.itemIds.some(id=>!config.items.some(item=>item.id===id && item.kind!=='guarantee'))) throw new Error('加成公式必须引用有效且不重复的加成项目');
    if(rule.definitionVersion===2 && config.kind!=='guarantee' && (formula.mode!=='additions' || formula.itemIds.length!==config.items.length || formula.itemIds.some((id,index)=>id!==config.items[index].id))) throw new Error('计算公式必须按列表顺序包含所有统计项目');
  }
}

interface Context {row:LiveMonthly;employee:Employee;room:LiveRoom;referenceDate:string}
type EnrichedMonthly = LiveMonthly & {effectiveRegularPremium?:number};
function metricValue(row:LiveMonthly,field:CompensationMetric):number {
  const source=row as EnrichedMonthly;
  let value:unknown;
  if (field==='regularHours') value=finite(validNumber(row.hours,'总时长')-validNumber(row.nightHours,'夜班时长')-validNumber(row.earlyHours,'早班时长'),'正常时长');
  else if (field==='regularPremium') value=source.effectiveRegularPremium ?? finite(validNumber(row.premium,'总保费')-validNumber(source.nightPremium,'夜班保费')-validNumber(source.earlyPremium,'早班保费'),'正常保费');
  else if (field==='regularSpend') value=finite(validNumber(row.spend,'总消耗')-validNumber(row.nightSpend,'夜班消耗')-validNumber(row.earlySpend,'早班消耗'),'正常消耗');
  else if (field==='roi'||field==='hourlySpend') {
    const denominator=validNumber(field==='roi'?row.spend:row.hours,field==='roi'?'消耗':'时长');
    if (!denominator) throw new Error(field==='roi'?'消耗为零，无法计算 ROI':'时长为零，无法计算时耗');
    value=(field==='roi'?validNumber(row.premium,'保费'):validNumber(row.spend,'消耗'))/denominator;
  } else value=source[field];
  const valid=validNumber(value,compensationMetricOptions.find(option=>option.field===field)!.label);
  if(field==='waitingSalaryDays' && !Number.isSafeInteger(valid)) throw new Error('等待薪资天数必须为非负安全整数');
  return valid;
}
function guaranteeRateValue(row:LiveMonthly,field:string):number {
  const option=guaranteeRateFieldOptions.find(option=>option.field===field)!;
  if(field==='month') referenceDateForMonth(row.month);
  const value=field==='month'?Number(row.month.slice(5,7)):(row as unknown as Record<string,unknown>)[field];
  return validNumber(value,`保薪变量「${option.label}」`);
}
function contextFor(row:LiveMonthly,employees:Employee[],rooms:LiveRoom[],month:string):Context {
  const employee=employees.find(employee=>employee.id===row.employeeId),room=rooms.find(room=>room.id===row.roomId);
  if (!employee || !room) throw new Error('月度数据员工或直播间归属缺失');
  return {row,employee,room,referenceDate:referenceDateForMonth(month)};
}
function conditionValue(field:string,context:Context):string|number|boolean {
  const option=conditionFieldOptions.find(option=>option.field===field)!;
  const [source,key]=field.split('.');
  let value:unknown;
  if(source==='monthly' && key==='year') {
    value=context.row.year;
    if(!Number.isSafeInteger(value) || (value as number)<1 || (value as number)>9999) throw new Error('年份 数据缺失或数值无效');
  } else if(source==='monthly' && key==='month') {
    referenceDateForMonth(context.row.month);
    value=Number(context.row.month.slice(5,7));
  } else value=source==='monthly'?metricValue(context.row,key as CompensationMetric):source==='employee'?(context.employee as unknown as Record<string,unknown>)[key]:source==='context'?context.referenceDate:(context.room as unknown as Record<string,unknown>)[key];
  if (option.type==='date') {dateNumber(value,option.label);return value as string;}
  if (typeof value!==option.type || (option.type==='number'&&!nonnegative(value))) throw new Error(`${option.label} 数据缺失或类型无效`);
  return value as string|number|boolean;
}
function adjustedConditionValue(value:string|number|boolean,key:string,adjustment:NumericAdjustment|undefined,values:Record<string,string|number|boolean>):string|number|boolean {
  if(adjustment===undefined) return value;
  if(typeof value!=='number' || !Number.isFinite(value)) throw new Error('数值运算来源缺失或类型无效');
  const result=adjustment.operator==='add'?value+adjustment.value:value-adjustment.value;
  if(!Number.isFinite(result)) throw new Error('条件数值运算溢出或非有限数值');
  values[`${adjustment.operator}(${key},${adjustment.value})`]=result;
  return result;
}
function evaluateCondition(group:ConditionGroup,context:Context,values:Record<string,string|number|boolean>):boolean {
  const results=group.children.map(child=>{
    if (child.kind==='group') return evaluateCondition(child,context,values);
    let value=conditionValue(child.field,context);values[child.field]=value;
    let valueKey=child.field;
    if(child.transform!==undefined) {
      const date=new Date(dateNumber(value,child.field));
      value=child.transform==='year'?date.getUTCFullYear():date.getUTCMonth()+1;
      valueKey=`${child.transform}(${child.field})`;
      values[valueKey]=value;
    }
    value=adjustedConditionValue(value,valueKey,child.adjustment,values);
    if(child.operator==='withinCalendarMonths' || child.operator==='beforeCalendarMonths') {
      const reference=new Date(`${context.referenceDate}T00:00:00Z`);
      reference.setUTCDate(1);
      reference.setUTCMonth(reference.getUTCMonth()-(child.value as number)+1);
      if(!Number.isFinite(reference.getTime()) || reference.getUTCFullYear()<1) throw new Error('过去月数超出有效日期范围');
      values[`calendarWindowStart(${child.value})`]=reference.toISOString().slice(0,10);
      values['context.referenceDate']=context.referenceDate;
      const date=dateNumber(value,child.field);
      return child.operator==='beforeCalendarMonths' ? date<reference.getTime() : date>=reference.getTime() && date<=dateNumber(context.referenceDate,'核算基准');
    }
    if (child.operator==='withinMonths') {
      values['context.referenceDate']=context.referenceDate;
      const reference=new Date(`${context.referenceDate}T00:00:00Z`),day=reference.getUTCDate();
      reference.setUTCDate(1); reference.setUTCMonth(reference.getUTCMonth()-(child.value as number));
      const monthEnd=new Date(reference);monthEnd.setUTCMonth(monthEnd.getUTCMonth()+1);monthEnd.setUTCDate(0);
      reference.setUTCDate(Math.min(day,monthEnd.getUTCDate()));
      if (!Number.isFinite(reference.getTime())) throw new Error('相对日期月数超出有效日期范围');
      const date=dateNumber(value,child.field);
      return date>=reference.getTime() && date<=dateNumber(context.referenceDate,'核算基准');
    }
    let comparison=child.compareField!==undefined?conditionValue(child.compareField,context):child.value!;
    if(child.compareField!==undefined) values[child.compareField]=comparison;
    const comparisonKey=child.compareField??`literal(${child.value})`;
    if(child.compareField===undefined && child.compareAdjustment!==undefined) values[comparisonKey]=comparison;
    comparison=adjustedConditionValue(comparison,comparisonKey,child.compareAdjustment,values);
    // Every condition is evaluated, including alternatives, so required missing inputs never hide behind short circuiting.
    if (child.operator==='eq') return value===comparison;
    if (child.operator==='ne') return value!==comparison;
    if (child.operator==='gt') return value>comparison;
    if (child.operator==='gte') return value>=comparison;
    if (child.operator==='lt') return value<comparison;
    return value<=comparison;
  });
  return group.operator==='and'?results.every(Boolean):results.some(Boolean);
}
function scopeMatches(rule:CompensationRule,context:Context,month:string,conditions?:ConditionEvidence[]):boolean {
  if (context.row.month!==month || !context.row.roles.includes('主播') || context.employee.status!=='在职' || !context.room.active) return false;
  if (rule.scope==='rooms') return rule.roomIds.includes(context.row.roomId);
  if (rule.scope==='employees') {
    const values:Record<string,string|number|boolean>={};
    const matched=evaluateCondition(rule.employeeCondition!,context,values);
    conditions?.push({ruleId:rule.id,condition:structuredClone(rule.employeeCondition!),matched,values});
    return matched;
  }
  return true;
}
export function matchesCompensationRule(rule:CompensationRule,row:LiveMonthly,employees:Employee[],rooms:LiveRoom[],month:string):boolean {
  validateCompensationRule(rule);
  const context=contextFor(row,employees,rooms,month);
  for (const id of rule.roomIds) if (!rooms.some(room=>room.id===id)) throw new Error('规则直播间归属无效');
  return scopeMatches(rule,context,month);
}
export function calculateCompensation(rows:LiveMonthly[],employees:Employee[],deps:Department[],rooms:LiveRoom[],rules:CompensationRule[],month:string):CompensationResult {
  const referenceDate=referenceDateForMonth(month);
  if ([employees,rooms,deps].some(items=>new Set(items.map(item=>item.id)).size!==items.length)) throw new Error('员工、直播间或部门 ID 重复');
  if (new Set(rules.map(rule=>rule.id)).size!==rules.length) throw new Error('规则 ID 重复或版本漂移');
  const activeRules=rules.filter(rule=>rule.status==='已发布'&&!rule.deletedAt);
  activeRules.forEach(rule=>{
    validateCompensationRule(rule);
    if (rule.roomIds.some(id=>!rooms.some(room=>room.id===id && room.active))) throw new Error('规则直播间无效或已停用');
  });
  if (!activeRules.length) return {settlementVersion:2,salaries:[],rows:[],referenceDate};
  const selected=rows.filter(row=>row.month===month&&row.roles.includes('主播'));
  const rowKey=(row:LiveMonthly)=>JSON.stringify([row.employeeId,row.roomId,row.month]);
  if (new Set(selected.map(rowKey)).size!==selected.length) throw new Error('月度数据基础粒度重复（员工＋直播间＋月份）');
  const working=selected.flatMap(row=>{
    const context=contextFor(row,employees,rooms,month);
    if (context.employee.status!=='在职'||!context.room.active) return [];
    const department=deps.find(department=>department.id===row.departmentId);
    if (!department?.active || context.employee.departmentId!==row.departmentId) throw new Error('月度数据部门归属无效或已停用');
    if (context.room.productId!==row.productId) throw new Error('月度数据产品与直播间归属不一致');
    for (const field of ['hours','spend','premium'] as const) validNumber(row[field],field);
    for (const option of compensationMetricOptions) {
      if (['roi','hourlySpend','roiRank','past3MonthsAvgHourlyRate'].includes(option.field)) continue;
      const value=(row as EnrichedMonthly)[option.field];
      if (value!==undefined) {
        validNumber(value,option.label);
        if(option.field==='waitingSalaryDays') metricValue(row,option.field);
      }
    }
    // Optional derived fields are recomputed; source early contribution is never invented.
    if (row.nightHours!==undefined || row.earlyHours!==undefined) metricValue(row,'regularHours');
    const early=(row as EnrichedMonthly).earlyPremium;
    if (early!==undefined) {validNumber(early,'早班保费');if(early>row.premium) throw new Error('早班保费超过总保费');}
    if(row.nightPremium!==undefined) {validNumber(row.nightPremium,'夜班保费');if(row.nightPremium>row.premium) throw new Error('夜班保费超过总保费');}
    if(early!==undefined&&row.nightPremium!==undefined) metricValue(row,'regularPremium');
    const conditions:ConditionEvidence[]=[];
    const contextCopy={...context,row:structuredClone(row)};
    const allowanceItems:PayrollRowCalculation['allowanceItems']=[];
    const matchedRuleIds:string[]=[];
    const emptyScope=():ScopeCalculation=>({allowance:0,premium:0,guarantee:0,additions:0,matchedRuleIds:[]});
    const scopes:Record<Scope,ScopeCalculation>={global:emptyScope(),rooms:emptyScope(),employees:emptyScope()};
    const ruleCalculations:RuleCalculation[]=[];
    const candidates:PremiumRuleCalculation[]=[];
    for (const rule of activeRules.filter(rule=>rule.type!=='hourly')) {
      if (!scopeMatches(rule,context,month,conditions)) continue;
      matchedRuleIds.push(rule.id);
      const scope=scopes[rule.scope];scope.matchedRuleIds.push(rule.id);
      if (rule.type==='allowance') {
        const field=rule.allowance!.field,sessions=metricValue(row,field),rate=rule.allowance!.amount;
        if(!Number.isSafeInteger(sessions)) throw new Error('补贴计数指标必须为非负安全整数');
        const amount=money(finite(sessions*rate,'补贴金额'));
        allowanceItems.push({ruleId:rule.id,field,sessions,rate,amount});
        scope.allowance=money(finite(scope.allowance+amount,'范围补贴汇总'));
        ruleCalculations.push({ruleId:rule.id,scope:rule.scope,type:'allowance',rate,amount,matched:true});
      } else {
        const config=rule.premium!;
        let candidate:PremiumRuleCalculation;
        if('items' in config) {
          const items=config.items.map(item=>{const value=metricValue(row,item.field);return {...item,value,amount:finite(value*item.coefficient,'系数项保费')};});
          candidate={ruleId:rule.id,items,amount:money(items.reduce((sum,item)=>finite(sum+item.amount,'保费计算公式'),0)),selected:false};
          ruleCalculations.push({ruleId:rule.id,scope:rule.scope,type:'premium',amount:candidate.amount,matched:true});
        } else {
          const values:Record<string,string|number|boolean>={};
          const matched=evaluateCondition(config.condition,context,values);
          conditions.push({ruleId:rule.id,condition:structuredClone(config.condition),matched,values});
          const earlyValue=metricValue(row,'earlyPremium'),regularValue=metricValue(row,'regularPremium'),rate=matched?config.coefficient:1;
          const effectiveEarly=finite(earlyValue*rate,'早班保费');
          candidate={ruleId:rule.id,selected:false,amount:money(finite(regularValue+effectiveEarly,'有效总保费')),items:[{id:'normal',name:'正常保费',field:'regularPremium',coefficient:1,value:regularValue,amount:regularValue},{id:'early',name:'早班保费',field:'earlyPremium',coefficient:rate,value:earlyValue,amount:effectiveEarly}]};
          ruleCalculations.push({ruleId:rule.id,scope:rule.scope,type:'premium',amount:candidate.amount,coefficient:rate,matched});
        }
        candidates.push(candidate);scope.premium=Math.max(scope.premium,candidate.amount);
      }
    }
    const rawEarly=early===undefined?null:validNumber(early,'早班保费');
    const regular=rawEarly===null||row.nightPremium===undefined?null:finite(row.premium-row.nightPremium-rawEarly,'正常保费');
    // A stable tie break also keeps effective early-premium metrics independent of rule order.
    const winner=candidates.reduce<PremiumRuleCalculation|undefined>((best,item)=>!best||item.amount>best.amount||(item.amount===best.amount&&item.ruleId<best.ruleId)?item:best,undefined);
    if(winner) winner.selected=true;
    const after=winner?.amount??row.premium;
    const earlyItems=winner?.items.filter(item=>item.field==='earlyPremium');
    const effectiveEarly=earlyItems?.length?earlyItems.reduce((sum,item)=>finite(sum+item.amount,'有效早班保费'),0):rawEarly;
    const effectiveCoefficient=earlyItems?.length?earlyItems.reduce((sum,item)=>finite(sum+item.coefficient,'早班保费系数'),0):1;
    const effectiveRow=contextCopy.row as EnrichedMonthly;
    effectiveRow.premium=after;
    if (effectiveEarly!==null) effectiveRow.earlyPremium=effectiveEarly;
    if (regular!==null) {effectiveRow.regularPremium=regular;effectiveRow.effectiveRegularPremium=regular;}
    effectiveRow.roi=row.spend>0?finite(after/row.spend,'有效 ROI'):null;
    effectiveRow.hourlySpend=row.hours>0?finite(row.spend/row.hours,'时耗'):null;
    const trace:PayrollRowCalculation={employeeId:row.employeeId,employeeName:context.employee.name,roomId:row.roomId,roomName:context.room.name,month,matchedRuleIds,statistics:structuredClone(row),scopes,guarantee:0,additions:0,ruleCalculations,allowance:money(Object.values(scopes).reduce((sum,scope)=>finite(sum+scope.allowance,'补贴汇总'),0)),allowanceItems,premium:{before:row.premium,regular,early:rawEarly,coefficient:effectiveCoefficient,after,roiBefore:row.spend>0?finite(row.premium/row.spend,'原始 ROI'):null,roiAfter:effectiveRow.roi,rank:null,...(candidates.length?{candidates}:{} )},durationGroups:[],conditions,total:0};
    return [{context:contextCopy,trace}];
  });
  // Rank only after every eligible row has received all coefficient rules.
  for (const work of working) {
    const row=work.context.row;
    const rank=row.roi===null?null:1+working.filter(other=>other.context.row.roomId===row.roomId && other.context.row.roi!==null && other.context.row.roi>row.roi!).length;
    row.roiRank=rank;row.spendRank=1+working.filter(other=>other.context.row.roomId===row.roomId&&other.context.row.spend>row.spend).length;work.trace.premium.rank=rank;
  }
  const traces:PayrollRowCalculation[]=[];
  for (const {context,trace} of working) {
    for (const rule of activeRules.filter(rule=>rule.type==='hourly')) {
      if (!scopeMatches(rule,context,month,trace.conditions)) continue;
      trace.matchedRuleIds.push(rule.id);
      const scope=trace.scopes![rule.scope];scope.matchedRuleIds.push(rule.id);
      const config=rule.hourly!;
      let group=trace.durationGroups.find(group=>group.scope===rule.scope&&group.duration===config.duration);
      if (!group) {group={scope:rule.scope,duration:config.duration,hours:metricValue(context.row,config.duration),guarantee:0,additions:0,rate:0,amount:0,items:[]};trace.durationGroups.push(group);}
      const formula=config.formula;
      const ids=formula.mode==='guarantee'?[formula.itemId]:formula.itemIds;
      const items:HourlyItemCalculation[]=[];
      for (const id of ids) {
        const item=config.items.find(item=>item.id===id)!;
        let matched=true;
        if (item.condition) {
          const values:Record<string,string|number|boolean>={};matched=evaluateCondition(item.condition,context,values);
          trace.conditions.push({ruleId:rule.id,itemId:item.id,condition:structuredClone(item.condition),matched,values});
        }
        const calculation:HourlyItemCalculation={ruleId:rule.id,itemId:item.id,name:item.name,kind:item.kind,rate:0,matched};
        if (matched && item.kind==='metric') {
          const matching=item.bands!.filter(band=>contains(metricValue(context.row,bandField(item,band)),band));
          if (!matching.length) throw new Error(`${context.employee.name} ${item.name} 未命中时薪区间`);
          if (matching.length>1) throw new Error(`${context.employee.name} ${item.name} 时薪区间多次命中，无法唯一匹配`);
          calculation.field=bandField(item,matching[0]);calculation.value=metricValue(context.row,calculation.field as CompensationMetric);calculation.rate=matching[0].rate;
        } else if (matched && item.kind==='guarantee' && item.rateField!==undefined) {
          calculation.field=item.rateField;calculation.value=guaranteeRateValue(trace.statistics!,item.rateField);calculation.rate=calculation.value;
        } else if (matched) calculation.rate=item.rate!;
        items.push(calculation);group.items.push(calculation);
      }
      const rate=items.reduce((sum,item)=>finite(sum+item.rate,'规则时薪汇总'),0);
      const amount=money(finite(rate*group.hours,'规则时薪金额'));
      trace.ruleCalculations!.push({ruleId:rule.id,scope:rule.scope,type:'hourly',mode:formula.mode,rate,duration:config.duration,hours:group.hours,amount,matched:items.some(item=>item.matched)});
      if(formula.mode==='guarantee') {scope.guarantee=Math.max(scope.guarantee,amount);group.guarantee=Math.max(group.guarantee,rate);}
      else {scope.additions=money(finite(scope.additions+amount,'范围加成金额汇总'));group.additions=finite(group.additions+rate,'加成时薪汇总');}
    }
    // Duration groups are explanatory evidence; settlement compares full rule amounts across durations.
    for (const group of trace.durationGroups) {
      group.rate=Math.max(group.guarantee,group.additions);
      const calculations=trace.ruleCalculations!.filter(item=>item.type==='hourly'&&item.scope===group.scope&&item.duration===group.duration);
      const guarantee=calculations.reduce((maximum,item)=>item.mode==='guarantee'?Math.max(maximum,item.amount):maximum,0);
      const additions=calculations.reduce((sum,item)=>item.mode==='additions'?finite(sum+item.amount,'时长加成金额汇总'):sum,0);
      group.amount=money(Math.max(guarantee,additions));
    }
    const scopes=Object.values(trace.scopes!);
    trace.guarantee=Math.max(...scopes.map(scope=>scope.guarantee));
    trace.additions=money(scopes.reduce((sum,scope)=>finite(sum+scope.additions,'加成金额汇总'),0));
    trace.total=money(finite(Math.max(trace.guarantee,trace.additions)+trace.allowance,'薪资汇总'));
    traces.push(trace);
  }
  const salaries:Salary[]=[];
  for (const employee of employees) {
    const employeeTraces=traces.filter(trace=>trace.employeeId===employee.id);
    if (!employeeTraces.length) continue;
    const commission=money(employeeTraces.reduce((sum,trace)=>finite(sum+trace.total,'员工薪资汇总'),0));
    const details=employeeTraces.map(trace=>{
      const row=working.find(work=>work.trace===trace)!.context.row;
      return {groupId:rowKey(row),groupName:trace.roomName,projectIds:[trace.roomId],roomIds:[trace.roomId],productIds:[row.productId],hours:row.hours,spend:row.spend,premium:trace.premium.after,roi:trace.premium.roiAfter??0,hourlySpend:row.hourlySpend??0,rate:trace.durationGroups.reduce((sum,group)=>finite(sum+group.rate,'汇总时薪'),0),commission:trace.total,matches:[],ruleName:trace.matchedRuleIds.map(id=>activeRules.find(rule=>rule.id===id)!.name).join('、'),ruleVersion:Math.max(0,...trace.matchedRuleIds.map(id=>activeRules.find(rule=>rule.id===id)!.version))};
    });
    salaries.push({employeeId:employee.id,employeeName:employee.name,departmentName:deps.find(department=>department.id===employee.departmentId)!.name,fixed:0,commission,total:commission,details});
  }
  return {settlementVersion:2,salaries,rows:traces,referenceDate};
}
