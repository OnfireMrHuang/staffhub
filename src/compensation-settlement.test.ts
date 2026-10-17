import {describe,expect,it} from 'vitest';
import type {Employee} from './domain';
import type {LiveMonthly} from './live-domain';
import type {LiveRoom} from './operations-domain';
import {calculateCompensation,matchesCompensationRule,payrollPerformanceAmount,type CompensationRule,type ConditionGroup,type HourlyItem,type NewDuration,type Scope} from './compensation-rules';

const employee:Employee={id:'e1',name:'甲',departmentId:'live',position:'投手',joined:'2026-01-01',status:'在职',phone:'',email:'',identities:[],role:'',nonCompeteSigned:true};
const room:LiveRoom={id:'r1',name:'一',platformAccountId:'a',productId:'p',active:true};
const departments=[{id:'live',name:'直播部',active:true}];
const row=(overrides:Partial<LiveMonthly>={}):LiveMonthly=>({employeeId:'e1',employeeName:'甲',departmentId:'live',departmentName:'直播部',roomId:'r1',roomName:'一',productId:'p',productName:'产品',month:'2026-10',year:2026,roles:['主播'],hostNames:['甲'],hours:10,nightHours:2,earlyHours:3,regularHours:5,spend:100,premium:1000,nightPremium:100,earlyPremium:200,regularPremium:700,roi:10,hourlySpend:10,nightSpend:20,earlySpend:30,sessions:4,nightSessions:2,earlySessions:2,roiRank:1,...overrides});
const condition=(field:string,value:string|number|boolean):ConditionGroup=>({kind:'group',operator:'and',children:[{kind:'condition',field,operator:'eq',value}]});
const scoped=(scope:Scope):Pick<CompensationRule,'scope'|'roomIds'|'employeeCondition'>=>({scope,roomIds:scope==='rooms'?['r1']:[],...(scope==='employees'?{employeeCondition:condition('employee.nonCompeteSigned',true)}:{})});
const allowance=(id:string,amount:number,scope:Scope='global'):CompensationRule=>({id,name:id,version:1,status:'已发布',...scoped(scope),type:'allowance',allowance:{field:'nightSessions',amount}});
const hourly=(id:string,rate:number,duration:NewDuration='hours',mode:'guarantee'|'additions'='additions',scope:Scope='global'):CompensationRule=>({id,name:id,version:1,status:'已发布',...scoped(scope),type:'hourly',hourly:{duration,items:[{id:'item',name:id,kind:mode==='guarantee'?'guarantee':'special',rate}],formula:mode==='guarantee'?{mode,itemId:'item'}:{mode,itemIds:['item']}}});
const premium=(id:string,coefficient:number,scope:Scope='global',expectedSessions=2):CompensationRule=>({id,name:id,version:1,status:'已发布',...scoped(scope),type:'premium',premium:{normalField:'regularPremium',earlyField:'earlyPremium',coefficient,condition:condition('monthly.earlySessions',expectedSessions)}});
const metric=(id:string,field:string,exact:number,rate:number):CompensationRule=>{const rule=hourly(id,rate);rule.hourly!.items=[{id:'item',name:id,kind:'metric',field,bands:[{keyType:'exact',exact,includeMin:true,includeMax:true,rate}]}];return rule;};
const calculate=(rules:CompensationRule[],rows=[row()],employees=[employee],rooms=[room])=>calculateCompensation(rows,employees,departments,rooms,rules,'2026-10');

describe('layered host payroll settlement',()=>{
 it('compares guarantee amounts across durations before choosing the final monthly pay',()=>{
  const result=calculate([hourly('whole-month',100,'hours','guarantee'),hourly('night-only',300,'nightHours','guarantee'),hourly('addition',20),allowance('allowance',10)]);
  expect(result.settlementVersion).toBe(2);
  expect(result.rows[0]).toMatchObject({guarantee:1000,additions:200,performance:1000,allowance:20,total:1020});
  expect(result.rows[0].ruleCalculations).toEqual(expect.arrayContaining([{ruleId:'whole-month',scope:'global',type:'hourly',mode:'guarantee',rate:100,duration:'hours',hours:10,amount:1000,matched:true},{ruleId:'night-only',scope:'global',type:'hourly',mode:'guarantee',rate:300,duration:'nightHours',hours:2,amount:600,matched:true}]));
 });

 it('sums allowances and additions across scopes while selecting the largest guarantee and premium amount',()=>{
  const rules:CompensationRule[]=[];
  for(const [scope,index] of (['global','rooms','employees'] as Scope[]).map((scope,index)=>[scope,index+1] as const)) rules.push(allowance(`${scope}-allowance`,index*10,scope),premium(`${scope}-premium`,index,scope),hourly(`${scope}-guarantee`,index*50,'hours','guarantee',scope),hourly(`${scope}-addition`,index*40,'hours','additions',scope));
  const result=calculate(rules),trace=result.rows[0];
  expect(trace.scopes).toEqual({global:{allowance:20,premium:900,guarantee:500,additions:400,matchedRuleIds:['global-allowance','global-premium','global-guarantee','global-addition']},rooms:{allowance:40,premium:1100,guarantee:1000,additions:800,matchedRuleIds:['rooms-allowance','rooms-premium','rooms-guarantee','rooms-addition']},employees:{allowance:60,premium:1300,guarantee:1500,additions:1200,matchedRuleIds:['employees-allowance','employees-premium','employees-guarantee','employees-addition']}});
  expect(trace).toMatchObject({allowance:120,guarantee:1500,additions:2400,performance:2400,total:2520,premium:{after:1300}});
  expect(trace.durationGroups.map(group=>group.scope)).toEqual(['global','rooms','employees']);
  expect(result.salaries[0].total).toBe(2520);
 });

 it('reads saved performance first and derives only complete frozen hourly amounts for legacy traces',()=>{
  const trace=calculate([hourly('floor',100,'hours','guarantee'),hourly('addition',20),allowance('allowance',10)]).rows[0];
  expect(payrollPerformanceAmount(trace)).toBe(1000);
  const savedZero={...trace,performance:0};
  expect(payrollPerformanceAmount(savedZero)).toBe(0);
  const historical={...trace,performance:undefined,total:5000};
  const before=structuredClone(historical);
  expect(payrollPerformanceAmount(historical)).toBe(1000);
  expect(payrollPerformanceAmount({...historical,guarantee:0,additions:0})).toBe(0);
  expect(payrollPerformanceAmount({...historical,guarantee:0,additions:1234.56})).toBe(1234.56);
  expect(historical).toEqual(before);
  expect(Object.hasOwn(historical,'performance')).toBe(true);
  for(const incomplete of [
   {...historical,guarantee:undefined}, {...historical,additions:undefined},
   {...historical,guarantee:NaN}, {...historical,additions:Infinity},
   {...historical,guarantee:-1}, {...historical,guarantee:undefined,additions:undefined,scopes:undefined},
  ])expect(payrollPerformanceAmount(incomplete)).toBeUndefined();
 });

 it('applies every coefficient before ROI and host-only room ranking, regardless of rule order',()=>{
  const rank=hourly('rank',0);rank.hourly!.items=[{id:'item',name:'排名',kind:'metric',field:'roiRank',bands:[{keyType:'exact',exact:1,includeMin:true,includeMax:true,rate:80},{keyType:'range',min:2,includeMin:true,includeMax:false,rate:20}]}];
  const rows=[row(),row({employeeId:'e2',earlySessions:0,premium:1200,regularPremium:900}),row({employeeId:'e3',roles:['投手'],premium:10000,regularPremium:9700})];
  const employees=[employee,{...employee,id:'e2'},{...employee,id:'e3'}];
  const rules=[rank,premium('boost',3),premium('lower',2,'rooms')];
  const forward=calculate(rules,rows,employees),reverse=calculate([...rules].reverse(),rows,employees);
  expect(forward.rows.map(trace=>[trace.premium.after,trace.premium.roiAfter,trace.premium.rank,trace.total])).toEqual([[1300,13,1,800],[1100,11,2,200]]);
  expect(reverse.rows.map(trace=>[trace.premium.after,trace.premium.roiAfter,trace.premium.rank,trace.total])).toEqual(forward.rows.map(trace=>[trace.premium.after,trace.premium.roiAfter,trace.premium.rank,trace.total]));
 });

 it('selects premium candidate amount instead of the largest configured coefficient and uses the winner early amount',()=>{
  const failed=premium('not-triggered',5,'global',99),reduction=premium('triggered-reduction',0.5,'rooms');
  const trace=calculate([failed,reduction,metric('early-metric','earlyPremium',200,10)]).rows[0];
  expect(trace.premium).toMatchObject({after:900,coefficient:1});
  expect(trace.scopes).toMatchObject({global:{premium:900},rooms:{premium:800},employees:{premium:0}});
  expect(trace.ruleCalculations).toEqual(expect.arrayContaining([{ruleId:'not-triggered',scope:'global',type:'premium',amount:900,coefficient:1,matched:false},{ruleId:'triggered-reduction',scope:'rooms',type:'premium',amount:800,coefficient:0.5,matched:true}]));
  expect(trace.total).toBe(100);
 });

 it('uses the selected configurable premium expression early amount for later hourly metrics',()=>{
  const configured:CompensationRule={id:'items',name:'items',version:1,status:'已发布',scope:'global',roomIds:[],type:'premium',definitionVersion:2,premium:{items:[{id:'regular',name:'正常',field:'regularPremium',coefficient:1},{id:'early',name:'早班',field:'earlyPremium',coefficient:2}]}};
  const trace=calculate([configured,metric('effective-early','earlyPremium',400,10)]).rows[0];
  expect(trace.premium.after).toBe(1100);expect(trace.total).toBe(100);
 });

 it('breaks equal premium amounts by rule ID and retains raw early values omitted by the winner',()=>{
  const configured:CompensationRule={id:'a-items',name:'总保费系数',version:1,status:'已发布',scope:'global',roomIds:[],type:'premium',premium:{items:[{id:'total',name:'总保费',field:'premium',coefficient:1.1}]}};
  const rules=[premium('z-legacy',2),configured,metric('raw-early','earlyPremium',200,10)];
  for(const ordered of [rules,[...rules].reverse()]) {
   const trace=calculate(ordered).rows[0];
   expect(trace.premium.candidates?.filter(candidate=>candidate.selected).map(candidate=>candidate.ruleId)).toEqual(['a-items']);
   expect(trace).toMatchObject({total:100,premium:{after:1100,coefficient:1}});
  }
 });

 it('propagates a zero premium winner to ROI, early-premium metrics and ranking',()=>{
  const zero:CompensationRule={id:'zero',name:'zero',version:1,status:'已发布',scope:'global',roomIds:[],type:'premium',premium:{items:[{id:'early',name:'早班',field:'earlyPremium',coefficient:0}]}};
  const trace=calculate([zero,metric('zero-roi','roi',0,2),metric('zero-early','earlyPremium',0,3)]).rows[0];
  expect(trace).toMatchObject({total:50,premium:{after:0,coefficient:0,roiAfter:0,rank:1}});
 });

 it('retains eligible unmatched host rows with zero scope amounts and the source premium',()=>{
  const excluded={...allowance('other-room',20,'rooms'),roomIds:['r2']};
  const result=calculate([excluded],[row()],[employee],[room,{...room,id:'r2'}]);
  expect(result.rows).toHaveLength(1);expect(result.salaries).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({allowance:0,guarantee:0,additions:0,performance:0,total:0,premium:{after:1000},matchedRuleIds:[],ruleCalculations:[],scopes:{global:{allowance:0,premium:0,guarantee:0,additions:0,matchedRuleIds:[]},rooms:{allowance:0,premium:0,guarantee:0,additions:0,matchedRuleIds:[]},employees:{allowance:0,premium:0,guarantee:0,additions:0,matchedRuleIds:[]}}});
  expect(result.salaries[0].details[0].ruleVersion).toBe(0);
  expect(calculate([]).rows).toEqual([]);
 });

 it('selects role membership rather than employee position and excludes inactive contexts',()=>{
  const rule=allowance('host',20);
  expect(matchesCompensationRule(rule,row({roles:['投手']}),[employee],[room],'2026-10')).toBe(false);
  expect(matchesCompensationRule(rule,row({roles:['场控','主播']}),[employee],[room],'2026-10')).toBe(true);
  expect(calculate([rule],[row({roles:['投手']})]).rows).toEqual([]);
  expect(calculate([rule],[row()],[{...employee,status:'已离职'}]).rows).toEqual([]);
  expect(calculate([rule],[row()],[employee],[{...room,active:false}]).rows).toEqual([]);
 });

 it('settles each room separately and sums only that employee room amounts',()=>{
  const result=calculate([hourly('floor',100,'hours','guarantee'),hourly('night',400,'nightHours','guarantee')],[row(),row({roomId:'r2',hours:4,nightHours:1,earlyHours:1,regularHours:2})],[employee],[room,{...room,id:'r2'}]);
  expect(result.rows.map(trace=>[trace.roomId,trace.guarantee,trace.total])).toEqual([['r1',1000,1000],['r2',400,400]]);
  expect(result.salaries[0].total).toBe(1400);
 });

 it('applies one room rule bound to multiple rooms once to each matching room row',()=>{
  const shared={...hourly('shared-room-rate',30,'hours','additions','rooms'),roomIds:['r1','r2']};
  const result=calculate([shared],[row(),row({roomId:'r2',hours:4,nightHours:1,earlyHours:1}),row({roomId:'r3',hours:6,nightHours:1,earlyHours:1})],[employee],[room,{...room,id:'r2'},{...room,id:'r3'}]);
  expect(result.rows.map(trace=>[trace.roomId,trace.total,trace.scopes?.rooms.matchedRuleIds])).toEqual([['r1',300,['shared-room-rate']],['r2',120,['shared-room-rate']],['r3',0,[]]]);
  expect(result.salaries[0].total).toBe(420);
 });

 it('freezes a deep raw statistics snapshot and keeps inputs intact',()=>{
  const source=[row()],rules=[premium('boost',3),hourly('rate',20)],before=structuredClone({source,rules});
  const trace=calculate(rules,source).rows[0];
  expect(trace.statistics).toEqual(before.source[0]);expect({source,rules}).toEqual(before);
  expect(trace.statistics?.premium).toBe(1000);expect(trace.premium.after).toBe(1300);
  source[0].roles.push('投手');source[0].hostNames.push('乙');
  expect(trace.statistics?.roles).toEqual(['主播']);expect(trace.statistics?.hostNames).toEqual(['甲']);
 });

 it('rounds each rule amount before aggregation and uses only selected expression items',()=>{
  const a=hourly('a',0.0049),b=hourly('b',0.0049),floor=hourly('floor',0.005,'hours','guarantee');
  const unused:HourlyItem={id:'unused',name:'未选',kind:'special',rate:999};a.hourly!.items.push(unused);
  const trace=calculate([a,b,floor,allowance('small-a',0.0049),allowance('small-b',0.0049)],[row({hours:1,nightHours:0,earlyHours:0,regularHours:1,nightSessions:1})]).rows[0];
  expect(trace).toMatchObject({additions:0,guarantee:0.01,performance:0.01,allowance:0,total:0.01});
  expect(trace.ruleCalculations?.map(item=>item.amount)).toEqual([0,0,0,0,0.01]);
  expect(trace.durationGroups[0].items.map(item=>item.itemId)).toEqual(['item','item','item']);
 });

 it('rounds decimal half-cent amounts up for each rule before totals are combined',()=>{
  const trace=calculate([hourly('decimal-hourly',1.005),allowance('decimal-allowance',10.075)],[row({hours:1,nightHours:0,earlyHours:0,regularHours:1,nightSessions:1})]).rows[0];
  expect(trace).toMatchObject({additions:1.01,performance:1.01,allowance:10.08,total:11.09});
 });

 it('corrects multiplication error at half a cent without rounding lower amounts up',()=>{
  const rows=[row({hours:0.7,nightHours:0,earlyHours:0,regularHours:0.7})];
  expect(calculate([hourly('half-cent-product',0.05)],rows).rows[0].total).toBe(0.04);
  expect(calculate([hourly('lower-product',0.049)],rows).rows[0].total).toBe(0.03);
 });
});
