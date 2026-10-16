import {describe,expect,it} from 'vitest';
import type {Employee} from './domain';
import type {LiveMonthly} from './live-domain';
import type {LiveRoom} from './operations-domain';
import {calculateCompensation,conditionFieldOptions,guaranteeRateFieldOptions,validateCompensationRule,type CompensationRule,type HourlyItem} from './compensation-rules';

const employee:Employee={id:'e1',name:'甲',departmentId:'live',position:'主播',joined:'2026-07-01',status:'在职',phone:'',email:'',identities:[],role:'',nonCompeteSigned:true};
const room:LiveRoom={id:'r1',name:'一',platformAccountId:'a',productId:'p',active:true,openedOn:'2026-10-01'};
const monthly=(patch:Partial<LiveMonthly>={}):LiveMonthly=>({employeeId:'e1',employeeName:'甲',departmentId:'live',departmentName:'直播部',roomId:'r1',roomName:'一',productId:'p',productName:'产品',month:'2026-10',year:2026,roles:['主播'],hostNames:['甲'],hours:10,nightHours:2,earlyHours:3,spend:100,premium:1000,nightPremium:0,earlyPremium:200,regularPremium:800,regularHours:5,roi:10,hourlySpend:10,nightSpend:20,earlySpend:30,sessions:4,nightSessions:2,earlySessions:2,roiRank:4,...patch});
const guarantee=(patch:Partial<HourlyItem>={}):CompensationRule=>({id:'guarantee',name:'变量保薪',version:1,status:'已发布',definitionVersion:2,scope:'global',roomIds:[],type:'hourly',hourly:{duration:'hours',kind:'guarantee',items:[{id:'floor',name:'保薪',kind:'guarantee',rateField:'past3MonthsAvgHourlyRate',condition:{kind:'group',operator:'and',children:[{kind:'condition',field:'employee.nonCompeteSigned',operator:'eq',value:true}]},...patch}],formula:{mode:'guarantee',itemId:'floor'}}});
const calculate=(rule=guarantee(),row=monthly(),signed=true,otherRules:CompensationRule[]=[])=>calculateCompensation([row],[{...employee,nonCompeteSigned:signed}],[{id:'live',name:'直播部',active:true}],[room],[...otherRules,rule],'2026-10');

describe('guarantee rate from a monthly numeric field',()=>{
 it('offers raw monthly numeric fields and the new average rate without string or boolean columns',()=>{
  expect(guaranteeRateFieldOptions).toContainEqual({field:'past3MonthsAvgHourlyRate',label:'过去3个月的平均时薪',type:'number'});
  expect(guaranteeRateFieldOptions).toEqual(expect.arrayContaining([{field:'premium',label:'总保费',type:'number'},{field:'roi',label:'ROI',type:'number'},{field:'roiRank',label:'ROI排名',type:'number'}]));
  expect(guaranteeRateFieldOptions.every(option=>option.type==='number')).toBe(true);
  expect(guaranteeRateFieldOptions.some(option=>['employeeName','nonCompeteSigned','sessions'].includes(option.field))).toBe(false);
  expect(conditionFieldOptions).toContainEqual({field:'monthly.past3MonthsAvgHourlyRate',label:'过去3个月的平均时薪',type:'number'});
 });
 it('uses the field value as the hourly guarantee and freezes the source and evaluated rate',()=>{
  const row=monthly({past3MonthsAvgHourlyRate:68.25}),result=calculate(guarantee(),row);
  expect(result.rows[0].total).toBe(682.5);
  expect(result.rows[0].durationGroups[0].items[0]).toMatchObject({kind:'guarantee',field:'past3MonthsAvgHourlyRate',value:68.25,rate:68.25,matched:true});
  expect(result.rows[0].ruleCalculations![0]).toMatchObject({rate:68.25,amount:682.5});
  row.past3MonthsAvgHourlyRate=10;
  expect(result.rows[0].statistics!.past3MonthsAvgHourlyRate).toBe(68.25);
 });
 it('allows a real zero hourly field rate',()=>{
  const result=calculate(guarantee(),monthly({past3MonthsAvgHourlyRate:0}));
  expect(result.rows[0].total).toBe(0);
  expect(result.rows[0].durationGroups[0].items[0]).toMatchObject({value:0,rate:0,matched:true});
 });
 it('preserves existing fixed-value rules',()=>{
  const fixed=guarantee({rate:60});delete fixed.hourly!.items[0].rateField;
  expect(calculate(fixed).rows[0]).toMatchObject({total:600,durationGroups:[{items:[{rate:60,matched:true}]}]});
  expect(calculate(fixed).rows[0].durationGroups[0].items[0].field).toBeUndefined();
 });
 it.each([undefined,null,NaN,Infinity,-1,'60'])('rejects missing or invalid matched field value %j',(value)=>{
  expect(()=>calculate(guarantee(),monthly({past3MonthsAvgHourlyRate:value as number}))).toThrow(/平均时薪|缺失|数值/);
 });
 it('does not require an optional rate field when its guarantee condition is false',()=>{
  const result=calculate(guarantee(),monthly(),false);
  expect(result.rows[0].total).toBe(0);
  expect(result.rows[0].durationGroups[0].items[0]).toMatchObject({rate:0,matched:false});
  expect(result.rows[0].durationGroups[0].items[0].value).toBeUndefined();
 });
 it.each(['premium','roi','roiRank'] as const)('reads original %s rather than premium-adjusted statistics',(rateField)=>{
  const coefficient:CompensationRule={id:'coefficient',name:'保费翻倍',version:1,status:'已发布',scope:'global',roomIds:[],definitionVersion:2,type:'premium',premium:{items:[{id:'twice',name:'全部',field:'premium',coefficient:2}]}};
  const row=monthly(),result=calculate(guarantee({rateField}),row,true,[coefficient]);
  expect(result.rows[0].premium.after).toBe(2000);
  expect(result.rows[0].durationGroups[0].items[0]).toMatchObject({field:rateField,value:row[rateField],rate:row[rateField]});
  expect(result.rows[0].statistics![rateField]).toBe(row[rateField]);
  expect(result.rows[0].total).toBe(row[rateField]!*10);
 });
 it.each([['year',2026],['month',10]] as const)('exposes %s as numeric month/year value',(rateField,rate)=>{
  expect(calculate(guarantee({rateField})).rows[0].durationGroups[0].items[0]).toMatchObject({value:rate,rate});
 });
 it.each(['employeeName','nonCompeteSigned','employeeJoinedOn','unknown','monthly.past3MonthsAvgHourlyRate',''])('rejects nonnumeric or unknown rate source %s',(rateField)=>{
  expect(()=>validateCompensationRule(guarantee({rateField}))).toThrow(/保薪|字段/);
 });
 it('requires exactly one fixed or field rate and rejects an explicit conflicting empty fixed value',()=>{
  expect(()=>validateCompensationRule(guarantee({rate:50}))).toThrow(/保薪|互斥/);
  expect(()=>validateCompensationRule(guarantee({rate:undefined}))).toThrow(/保薪|互斥/);
  const empty=guarantee();delete empty.hourly!.items[0].rateField;
  expect(()=>validateCompensationRule(empty)).toThrow(/时薪|保薪/);
 });
 it.each(['special','metric'] as const)('rejects rate field on %s hourly items',(kind)=>{
  const rule=guarantee();rule.hourly!.kind=kind;
  const item=rule.hourly!.items[0];item.kind=kind;delete item.condition;
  if(kind==='special')item.rate=20;
  else {item.field='roi';item.bands=[{keyType:'range',min:0,includeMin:true,includeMax:false,rate:20}];}
  rule.hourly!.formula={mode:'additions',itemIds:[item.id]};
  expect(()=>validateCompensationRule(rule)).toThrow(/保薪|字段/);
 });
 it('supports the new monthly numeric field in a normal condition comparison',()=>{
  const fixed=guarantee({rate:60});delete fixed.hourly!.items[0].rateField;
  fixed.hourly!.items[0].condition={kind:'group',operator:'and',children:[{kind:'condition',field:'monthly.past3MonthsAvgHourlyRate',operator:'gte',value:60}]};
  expect(calculate(fixed,monthly({past3MonthsAvgHourlyRate:68.25})).rows[0].total).toBe(600);
 });
});
