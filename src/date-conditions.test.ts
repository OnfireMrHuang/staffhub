import {describe,expect,it} from 'vitest';
import type {Employee} from './domain';
import type {LiveMonthly} from './live-domain';
import type {LiveRoom} from './operations-domain';
import {calculateCompensation,conditionComparisonFields,conditionResultType,validateCompensationRule,type CompensationRule,type Condition,type ConditionGroup} from './compensation-rules';

const employee:Employee={id:'e1',name:'甲',departmentId:'live',position:'主播',joined:'2026-10-01',status:'在职',phone:'',email:'',identities:[],role:'',nonCompeteSigned:true};
const room:LiveRoom={id:'r1',name:'一',platformAccountId:'a',productId:'p',active:true,openedOn:'2026-10-01'};
const monthly=(patch:Partial<LiveMonthly>={}):LiveMonthly=>({employeeId:'e1',employeeName:'甲',departmentId:'live',departmentName:'直播部',roomId:'r1',roomName:'一',productId:'p',productName:'产品',month:'2026-10',year:2026,roles:['主播'],hostNames:['甲'],hours:10,nightHours:2,earlyHours:3,spend:100,premium:1000,nightPremium:0,earlyPremium:200,regularPremium:800,regularHours:5,roi:10,hourlySpend:10,nightSpend:20,earlySpend:30,sessions:4,nightSessions:2,earlySessions:2,roiRank:1,...patch});
const group=(...children:(Condition|ConditionGroup)[]):ConditionGroup=>({kind:'group',operator:'and',children});
const comparison=(patch:Partial<Condition>={}):Condition=>({kind:'condition',field:'employee.joined',operator:'eq',compareField:'room.openedOn',...patch});
const rule=(condition:ConditionGroup):CompensationRule=>({id:'guarantee',name:'日期保薪',version:1,status:'已发布',definitionVersion:2,scope:'global',roomIds:[],type:'hourly',hourly:{duration:'hours',kind:'guarantee',items:[{id:'floor',name:'保薪',kind:'guarantee',rate:60,condition}],formula:{mode:'guarantee',itemId:'floor'}}});
const calculate=(condition:ConditionGroup,options:{joined?:string;openedOn?:string;row?:Partial<LiveMonthly>;month?:string}={})=>calculateCompensation([monthly(options.row)],[{...employee,...(Object.hasOwn(options,'joined')?{joined:options.joined as string}:{})}],[{id:'live',name:'直播部',active:true}],[{...room,...(Object.hasOwn(options,'openedOn')?{openedOn:options.openedOn}:{})}],[rule(condition)],options.month??'2026-10');

describe('typed date conditions',()=>{
 it('offers only date operands without a transform and number operands after YEAR/MONTH',()=>{
  expect(conditionResultType(comparison())).toBe('date');
  expect(conditionComparisonFields(comparison()).map(item=>item.field)).toEqual(['employee.joined','room.openedOn','context.referenceDate']);
  const transformed=comparison({transform:'year',compareField:'monthly.year'});
  expect(conditionResultType(transformed)).toBe('number');
  expect(conditionComparisonFields(transformed).map(item=>item.field)).toEqual(expect.arrayContaining(['monthly.year','monthly.month','monthly.spend']));
  expect(conditionComparisonFields(transformed).every(item=>item.type==='number')).toBe(true);
  expect(conditionResultType(comparison({field:'monthly.spend',transform:'year'}))).toBeUndefined();
  expect(conditionComparisonFields(comparison({transform:'unknown' as never}))).toEqual([]);
 });
 it.each([
  ['eq','2026-10-01',true],['ne','2026-10-02',true],['gt','2026-10-02',true],['gte','2026-10-01',true],['lt','2026-09-30',true],['lte','2026-10-01',true],['eq','2026-10-02',false],
 ] as const)('compares dates with %s and produces the guaranteed salary only when matched', (operator,joined,matched)=>{
  const result=calculate(group(comparison({operator})),{joined});
  expect(result.rows[0].total).toBe(matched?600:0);
  expect(result.rows[0].conditions[0]).toMatchObject({matched,values:{'employee.joined':joined,'room.openedOn':'2026-10-01'}});
 });
 it('extracts UTC year/month, compares the monthly numeric fields, and records both operands',()=>{
  const result=calculate(group(comparison({transform:'year',compareField:'monthly.year'}),comparison({transform:'month',compareField:'monthly.month'})));
  expect(result.rows[0].total).toBe(600);
  expect(result.rows[0].conditions[0].values).toEqual({'employee.joined':'2026-10-01','year(employee.joined)':2026,'monthly.year':2026,'month(employee.joined)':10,'monthly.month':10});
  expect(calculate(group(comparison({transform:'month',compareField:'monthly.month'})),{joined:'2025-10-01'}).rows[0].total).toBe(600);
  expect(calculate(group(comparison({transform:'year',compareField:'monthly.year'})),{joined:'2025-10-01'}).rows[0].total).toBe(0);
 });
 it('uses the frozen calculation month end and handles leap years/year boundaries',()=>{
  const condition=group(comparison({operator:'lte',compareField:'context.referenceDate'}));
  const leap=calculate(condition,{joined:'2024-02-29',row:{month:'2024-02',year:2024},month:'2024-02'});
  expect(leap.referenceDate).toBe('2024-02-29');
  expect(leap.rows[0].conditions[0].values['context.referenceDate']).toBe('2024-02-29');
  expect(leap.rows[0].total).toBe(600);
  expect(calculate(condition,{joined:'2025-01-01',row:{month:'2024-12',year:2024},month:'2024-12'}).rows[0].total).toBe(0);
  expect(calculate(group(comparison({transform:'month',compareField:'monthly.month'})),{joined:'2025-01-01',row:{month:'2025-01',year:2025},month:'2025-01'}).rows[0].total).toBe(600);
 });
 it('reads the actual monthly year field and supports transforms on every date source',()=>{
  expect(calculate(group(comparison({transform:'year',compareField:'monthly.year'})),{joined:'2025-10-01',row:{year:2025}}).rows[0].total).toBe(600);
  expect(calculate(group(comparison({field:'room.openedOn',transform:'month',compareField:'monthly.month'}))).rows[0].total).toBe(600);
  const result=calculate(group(comparison({field:'context.referenceDate',transform:'year',compareField:'monthly.year'})));
  expect(result.rows[0].conditions[0].values).toEqual({'context.referenceDate':'2026-10-31','year(context.referenceDate)':2026,'monthly.year':2026});
 });
 it.each([['0001-01',1],['0099-01',99],['9999-12',9999]] as const)('accepts ISO years without JavaScript two-digit year coercion: %s',(month,year)=>{
  const result=calculate(group(comparison({transform:'year',compareField:'monthly.year'})),{joined:`${month}-01`,row:{month,year},month});
  expect(result.rows[0].total).toBe(600);
 });
 it.each([
  {compareField:'monthly.year'},
  {transform:'year',compareField:'room.openedOn'},
  {transform:'year',compareField:'employee.name'},
  {transform:'year',compareField:'employee.nonCompeteSigned'},
  {transform:'month',compareField:'monthly.missing'},
  {transform:'day',compareField:'monthly.month'},
  {field:'monthly.spend',transform:'year',compareField:'monthly.year'},
  {compareField:'room.openedOn',value:'2026-10-01'},
  {transform:'year',compareField:undefined,value:2026},
  {transform:'year',compareField:undefined},
  {compareField:undefined},
  {compareField:'room.openedOn',operator:'withinMonths',value:3},
  {transform:'month',compareField:'monthly.month',operator:'withinMonths'},
 ])('rejects invalid field comparisons and never falls back to an absent literal: %j',(patch)=>{
  expect(()=>validateCompensationRule(rule(group(comparison(patch as Partial<Condition>))))).toThrow();
 });
 it.each(['','2026-02-29','2024-02-30','2026-13-01','0000-01-01','10000-01-01'])('rejects malformed or out-of-range date %s even behind an OR alternative',(joined)=>{
  const condition:ConditionGroup={kind:'group',operator:'or',children:[{kind:'condition',field:'employee.nonCompeteSigned',operator:'eq',value:true},comparison({transform:'year',compareField:'monthly.year'})]};
  expect(()=>calculate(condition,{joined})).toThrow(/日期/);
 });
 it.each([undefined,null,NaN,Infinity,'2026',2026.5,0,10000])('rejects invalid runtime numeric year operands %j',(year)=>{
  expect(()=>calculate(group(comparison({transform:'year',compareField:'monthly.year'})),{row:{year:year as number}})).toThrow();
 });
 it('validates both date field values and reads numeric comparison operands without coercion',()=>{
  expect(()=>calculate(group(comparison()),{openedOn:'2026-02-29'})).toThrow(/日期/);
  expect(()=>calculate(group(comparison({transform:'month',compareField:'monthly.adCost'})),{row:{adCost:undefined}})).toThrow(/缺失/);
  const result=calculate(group(comparison({transform:'month',operator:'gt',compareField:'monthly.nightSessions'})));
  expect(result.rows[0].total).toBe(600);
 });
 it('preserves historical literal and withinMonths rule snapshots without migration or mutation',()=>{
  const condition=group({kind:'condition',field:'employee.joined',operator:'withinMonths',value:3},{kind:'condition',field:'room.openedOn',operator:'lte',value:'2026-10-31'});
  const frozenRule=rule(condition),snapshot=structuredClone(frozenRule);
  Object.freeze(frozenRule);
  const result=calculateCompensation([monthly()],[{...employee,joined:'2026-07-31'}],[{id:'live',name:'直播部',active:true}],[room],[frozenRule],'2026-10');
  expect(result.rows[0].total).toBe(600);
  expect(frozenRule).toEqual(snapshot);
  expect(result.rows[0].conditions[0].condition).toEqual(snapshot.hourly!.items[0].condition);
  expect(calculate(condition,{joined:'2026-07-30'}).rows[0].total).toBe(0);
 });
});

describe('recent natural months including the calculation month',()=>{
 const recent=(field='employee.joined',months=3):Condition=>({kind:'condition',field,operator:'withinCalendarMonths',value:months});
 it.each(['employee.joined','room.openedOn'])('checks %s against complete calendar months instead of rolling dates',field=>{
  for(const [date,matched] of [['2026-07-31',false],['2026-08-01',true],['2026-08-31',true],['2026-10-31',true],['2026-11-01',false]] as const){
   const result=calculate(group(recent(field)),field==='employee.joined'?{joined:date}:{openedOn:date});
   expect(result.rows[0].total,`${field}: ${date}`).toBe(matched?600:0);
   expect(result.rows[0].conditions[0].values).toMatchObject({[field]:date,'calendarWindowStart(3)':'2026-08-01','context.referenceDate':'2026-10-31'});
  }
 });
 it.each([
  ['2026-01',3,'2025-11-01',true],['2026-01',3,'2025-10-31',false],
  ['2026-01',1,'2025-12-31',false],['2026-01',1,'2026-01-01',true],
  ['2026-10',4,'2026-07-01',true],['2026-10',4,'2026-06-30',false],
  ['2024-02',3,'2023-12-01',true],['2024-02',1,'2024-02-29',true],
  ['2024-02',1,'2024-03-01',false],
 ] as const)('uses month %s, N=%s, and date %s correctly',(month,n,joined,matched)=>{
  expect(calculate(group(recent('employee.joined',n)),{joined,month,row:{month,year:Number(month.slice(0,4))}}).rows[0].total).toBe(matched?600:0);
 });
 it.each([0,-1,1.5,NaN,Infinity,undefined,'3',Number.MAX_SAFE_INTEGER+1])('rejects invalid calendar-month count %j',value=>{
  expect(()=>validateCompensationRule(rule(group({...recent(),value:value as number})))).toThrow(/正整数/);
 });
 it.each([
  {field:'monthly.month'},{field:'employee.nonCompeteSigned'},
  {transform:'month'},{compareField:'context.referenceDate'},
  {adjustment:{operator:'add',value:3}},{compareAdjustment:{operator:'subtract',value:3}},
 ])('rejects combining calendar predicates with incompatible operands: %j',patch=>{
  expect(()=>validateCompensationRule(rule(group({...recent(),...patch} as Condition)))).toThrow(/月份条件/);
 });
 it('keeps a readable frozen condition and can combine newcomer predicates with OR',()=>{
  const condition:ConditionGroup={kind:'group',operator:'or',children:[recent(),recent('room.openedOn',2)]};
  const definition=rule(condition),before=structuredClone(definition);
  const result=calculateCompensation([monthly()],[{...employee,joined:'2026-01-01'}],[{id:'live',name:'直播部',active:true}],[{...room,openedOn:'2026-09-01'}],[definition],'2026-10');
  expect(result.rows[0].total).toBe(600);
  expect(result.rows[0].conditions[0].condition).toEqual(condition);
  expect(result.rows[0].conditions[0].values).toMatchObject({'calendarWindowStart(3)':'2026-08-01','calendarWindowStart(2)':'2026-09-01'});
  expect(definition).toEqual(before);
 });
 it('still rejects a missing or invalid source date and unreasonable date-window overflow',()=>{
  expect(()=>calculate(group(recent('room.openedOn')),{openedOn:undefined})).toThrow(/日期/);
  expect(()=>calculate(group(recent()),{joined:'2026-02-29'})).toThrow(/日期/);
  expect(()=>calculate(group(recent('employee.joined',Number.MAX_SAFE_INTEGER)))).toThrow(/日期范围/);
 });
});

describe('dates before the past N month window',()=>{
 const before=(field='employee.joined',months=3):Condition=>({kind:'condition',field,operator:'beforeCalendarMonths',value:months});
 it.each(['employee.joined','room.openedOn'])('uses an exclusive cutoff for %s and never matches future dates',field=>{
  for(const [date,matched] of [['2026-07-31',true],['2026-08-01',false],['2026-10-31',false],['2026-11-01',false]] as const) {
   const result=calculate(group(before(field)),field==='employee.joined'?{joined:date}:{openedOn:date});
   expect(result.rows[0].total,`${field}: ${date}`).toBe(matched?600:0);
   expect(result.rows[0].conditions[0]).toMatchObject({matched,condition:group(before(field)),values:{[field]:date,'calendarWindowStart(3)':'2026-08-01','context.referenceDate':'2026-10-31'}});
  }
 });
 it.each([
  ['2026-01',3,'2025-10-31',true],['2026-01',3,'2025-11-01',false],
  ['2026-01',1,'2025-12-31',true],['2026-01',1,'2026-01-01',false],
  ['2026-10',4,'2026-06-30',true],['2026-10',4,'2026-07-01',false],
  ['2024-03',1,'2024-02-29',true],['2024-03',1,'2024-03-01',false],
 ] as const)('uses %s N=%s cutoff for %s',(month,n,joined,matched)=>{
  expect(calculate(group(before('employee.joined',n)),{joined,month,row:{month,year:Number(month.slice(0,4))}}).rows[0].total).toBe(matched?600:0);
 });
 it('validates month counts and rejects incompatible operands',()=>{
  for(const value of [0,-1,1.5,NaN,Infinity,undefined,'3']) expect(()=>validateCompensationRule(rule(group({...before(),value:value as number})))).toThrow(/正整数/);
  for(const patch of [{field:'monthly.month'},{transform:'month'},{compareField:'context.referenceDate'},{adjustment:{operator:'add',value:3}},{compareAdjustment:{operator:'subtract',value:1}}]) {
   expect(()=>validateCompensationRule(rule(group({...before(),...patch} as Condition)))).toThrow(/月份条件/);
  }
 });
 it('rejects missing dates and windows outside the supported calendar',()=>{
  expect(()=>calculate(group(before('room.openedOn')),{openedOn:undefined})).toThrow(/日期/);
  expect(()=>calculate(group(before()),{joined:'2026-02-29'})).toThrow(/日期/);
  expect(()=>calculate(group(before('employee.joined',Number.MAX_SAFE_INTEGER)))).toThrow(/日期范围/);
 });
 it('combines inside and before predicates without rewriting frozen definitions',()=>{
  const condition=group(before(),{kind:'condition',field:'room.openedOn',operator:'withinCalendarMonths',value:3});
  const definition=rule(condition),snapshot=structuredClone(definition);
  const result=calculateCompensation([monthly()],[{...employee,joined:'2026-07-31'}],[{id:'live',name:'直播部',active:true}],[{...room,openedOn:'2026-08-01'}],[definition],'2026-10');
  expect(result.rows[0].total).toBe(600);
  expect(result.rows[0].conditions[0].condition).toEqual(condition);
  expect(definition).toEqual(snapshot);
 });
});
