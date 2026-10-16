import {describe,expect,it} from 'vitest';
import type {Employee} from './domain';
import type {LiveMonthly} from './live-domain';
import type {LiveRoom} from './operations-domain';
import {calculateCompensation,validateCompensationRule,type CompensationRule,type Condition,type ConditionGroup} from './compensation-rules';

const employee:Employee={id:'e1',name:'甲',departmentId:'live',position:'主播',joined:'2026-07-01',status:'在职',phone:'',email:'',identities:[],role:'',nonCompeteSigned:true};
const room:LiveRoom={id:'r1',name:'一',platformAccountId:'a',productId:'p',active:true,openedOn:'2026-10-01'};
const monthly=(patch:Partial<LiveMonthly>={}):LiveMonthly=>({employeeId:'e1',employeeName:'甲',departmentId:'live',departmentName:'直播部',roomId:'r1',roomName:'一',productId:'p',productName:'产品',month:'2026-10',year:2026,roles:['主播'],hostNames:['甲'],hours:10,nightHours:2,earlyHours:3,spend:100,premium:1000,nightPremium:0,earlyPremium:200,regularPremium:800,regularHours:5,roi:10,hourlySpend:10,nightSpend:20,earlySpend:30,sessions:4,nightSessions:2,earlySessions:2,roiRank:1,...patch});
const condition=(patch:Partial<Condition>={}):Condition=>({kind:'condition',field:'monthly.month',operator:'eq',value:10,...patch});
const rule=(conditions:Condition[]):CompensationRule=>({id:'guarantee',name:'数值运算保薪',version:1,status:'已发布',definitionVersion:2,scope:'global',roomIds:[],type:'hourly',hourly:{duration:'hours',kind:'guarantee',items:[{id:'floor',name:'保薪',kind:'guarantee',rate:60,condition:{kind:'group',operator:'and',children:conditions}}],formula:{mode:'guarantee',itemId:'floor'}}});
const calculate=(conditions:Condition[],row:Partial<LiveMonthly>={})=>calculateCompensation([monthly(row)],[employee],[{id:'live',name:'直播部',active:true}],[room],[rule(conditions)],'2026-10');

describe('numeric arithmetic in guarantee conditions',()=>{
 it.each([
  ['add',3,13],['subtract',3,7],['subtract',13,-3],['add',0,10],
 ] as const)('applies %s %s to a numeric field before comparison',(operator,value,expected)=>{
  const result=calculate([condition({adjustment:{operator,value},compareAdjustment:{operator:'subtract',value:20},value:expected+20})]);
  expect(result.rows[0].total).toBe(600);
  expect(result.rows[0].conditions[0].values[`${operator}(monthly.month,${value})`]).toBe(expected);
 });
 it('applies operations independently to both fields and records original and evaluated operands',()=>{
  const result=calculate([{kind:'condition',field:'monthly.month',operator:'eq',adjustment:{operator:'add',value:2},compareField:'monthly.hours',compareAdjustment:{operator:'add',value:2}}]);
  expect(result.rows[0].total).toBe(600);
  expect(result.rows[0].conditions[0].values).toEqual({'monthly.month':10,'add(monthly.month,2)':12,'monthly.hours':10,'add(monthly.hours,2)':12});
 });
 it('compares an extracted month to a monthly field offset',()=>{
  const result=calculate([{kind:'condition',field:'employee.joined',transform:'month',operator:'eq',compareField:'monthly.month',compareAdjustment:{operator:'subtract',value:3}}]);
  expect(result.rows[0].total).toBe(600);
  expect(result.rows[0].conditions[0].values).toEqual({'employee.joined':'2026-07-01','month(employee.joined)':7,'monthly.month':10,'subtract(monthly.month,3)':7});
 });
 it('applies an adjustment after extracting a date part and preserves both expression values',()=>{
  const result=calculate([{kind:'condition',field:'employee.joined',transform:'month',adjustment:{operator:'add',value:3},operator:'eq',compareField:'monthly.month'}]);
  expect(result.rows[0].total).toBe(600);
  expect(result.rows[0].conditions[0].values['month(employee.joined)']).toBe(7);
  expect(result.rows[0].conditions[0].values['add(month(employee.joined),3)']).toBe(10);
 });
 it('records literal operands only when an operation is applied and does not mutate the saved definition',()=>{
  const definition=rule([condition({compareAdjustment:{operator:'add',value:3},value:7})]),snapshot=structuredClone(definition);
  const result=calculateCompensation([monthly()],[employee],[{id:'live',name:'直播部',active:true}],[room],[definition],'2026-10');
  expect(result.rows[0].total).toBe(600);
  expect(result.rows[0].conditions[0].values).toEqual({'monthly.month':10,'literal(7)':7,'add(literal(7),3)':10});
  expect(definition).toEqual(snapshot);
  expect(calculate([condition()]).rows[0].conditions[0].values).toEqual({'monthly.month':10});
 });
 it('supports inequality boundaries after arithmetic rather than comparing the original operands',()=>{
  expect(calculate([condition({operator:'lt',adjustment:{operator:'add',value:3},value:13})]).rows[0].total).toBe(0);
  expect(calculate([condition({operator:'lte',adjustment:{operator:'add',value:3},value:13})]).rows[0].total).toBe(600);
 });
 it.each([null,[],{},'3',{operator:'multiply',value:3},{operator:'add'},{operator:'add',value:'3'},{operator:'add',value:-1},{operator:'add',value:NaN},{operator:'add',value:Infinity},{operator:'add',value:3,extra:true}])('rejects malformed adjustment %j on either side',(adjustment)=>{
  for(const key of ['adjustment','compareAdjustment']) expect(()=>validateCompensationRule(rule([condition({[key]:adjustment} as Partial<Condition>)]))).toThrow(/运算|数值/);
 });
 it.each([
  {field:'employee.joined',value:'2026-07-01'},
  {field:'employee.joined',operator:'withinMonths',value:3},
  {field:'employee.nonCompeteSigned',value:true},
  {field:'employee.name',value:'甲'},
 ])('rejects arithmetic for nonnumeric operands and legacy relative dates: %j',(patch)=>{
  for(const key of ['adjustment','compareAdjustment']) expect(()=>validateCompensationRule(rule([condition({...patch,[key]:{operator:'add',value:1}} as Partial<Condition>)]))).toThrow(/数值/);
 });
 it('rejects arithmetic on date-to-date comparisons and keeps typed date constraints',()=>{
  expect(()=>validateCompensationRule(rule([{kind:'condition',field:'employee.joined',operator:'eq',compareField:'room.openedOn',compareAdjustment:{operator:'add',value:1}}]))).toThrow(/数值/);
  expect(()=>validateCompensationRule(rule([{kind:'condition',field:'employee.joined',transform:'month',operator:'eq',compareField:'room.openedOn',adjustment:{operator:'add',value:3}}]))).toThrow(/类型/);
 });
 it('rejects overflow in each arithmetic operand without coercion or clamping',()=>{
  expect(()=>calculate([condition({field:'monthly.spend',adjustment:{operator:'add',value:Number.MAX_VALUE},value:0})],{spend:Number.MAX_VALUE})).toThrow(/溢出|有限/);
  expect(()=>calculate([condition({compareAdjustment:{operator:'add',value:Number.MAX_VALUE},value:Number.MAX_VALUE})])).toThrow(/溢出|有限/);
 });
 it('never hides a missing numeric operand behind a true OR branch',()=>{
  const definition=rule([]),group:ConditionGroup={kind:'group',operator:'or',children:[condition(),{kind:'condition',field:'monthly.month',operator:'gt',compareField:'monthly.adCost',compareAdjustment:{operator:'add',value:1}}]};
  definition.hourly!.items[0].condition=group;
  expect(()=>calculateCompensation([monthly()],[employee],[{id:'live',name:'直播部',active:true}],[room],[definition],'2026-10')).toThrow(/缺失/);
 });
});
