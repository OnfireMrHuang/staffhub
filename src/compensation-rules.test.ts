import {describe,it,expect} from 'vitest';
import type {Employee} from './domain';
import type {LiveMonthly} from './live-domain';
import type {LiveRoom} from './operations-domain';
import {allowanceCountOptions,conditionFieldOptions,calculateCompensation,referenceDateForMonth,matchesCompensationRule,validateCompensationRule,type CompensationRule,type ConditionGroup,type HourlyItem,type NewDuration,type NewRuleBand} from './compensation-rules';
const employee:Employee={id:'e1',name:'甲',departmentId:'live',position:'主播',joined:'2026-07-31',status:'在职',phone:'',email:'',identities:[],role:'',nonCompeteSigned:true};
const room:LiveRoom & {openedOn:string}={id:'r1',name:'一',platformAccountId:'a',productId:'p',active:true,openedOn:'2026-07-31'};
const deps=[{id:'live',name:'直播部',active:true}];
const row=(value:Partial<LiveMonthly> & {earlyPremium?:number;regularPremium?:number;regularHours?:number}={}):LiveMonthly=>({employeeId:'e1',employeeName:'甲',departmentId:'live',departmentName:'直播部',roomId:'r1',roomName:'一',productId:'p',productName:'产品',month:'2026-10',year:2026,roles:['主播','投手','场控'],hostNames:['甲'],hours:10,nightHours:2,earlyHours:3,spend:100,premium:1000,nightPremium:0,earlyPremium:200,regularPremium:800,regularHours:5,roi:10,hourlySpend:10,nightSpend:20,earlySpend:30,sessions:4,nightSessions:2,earlySessions:2,roiRank:1,...value} as LiveMonthly);
const condition=(field:string,value:string|number|boolean,operator:'eq'|'gte'|'withinMonths'='eq'):ConditionGroup=>({kind:'group',operator:'and',children:[{kind:'condition',field,operator,value}]});
const rule=(value:Partial<CompensationRule>={}):CompensationRule=>({id:'a',name:'规则',version:1,status:'已发布',scope:'global',roomIds:[],type:'allowance',allowance:{field:'nightSessions',amount:20},...value});
const hourly=(id:string,items:HourlyItem[],duration:NewDuration='hours',guarantee=false)=>rule({id,type:'hourly',allowance:undefined,hourly:{duration,items,formula:guarantee?{mode:'guarantee',itemId:items[0].id}:{mode:'additions',itemIds:items.map(i=>i.id)}}});
const flat=(id:string,rate:number,kind:'special'|'guarantee'='special'):HourlyItem=>({id,name:id,kind,rate});
const band=(value:Partial<NewRuleBand>={}):NewRuleBand=>({keyType:'range',min:0,includeMin:true,includeMax:false,rate:30,...value});
const calculate=(rules:CompensationRule[],rows=[row()],employees=[employee],rooms:LiveRoom[]=[room])=>calculateCompensation(rows,employees,deps,rooms,rules,'2026-10');
describe('merged compensation',()=>{
 it('merges all three scopes once per row: cumulative allowances, max coefficient/floor, summed additions and distinct durations',()=>{
  const premium=(id:string,coefficient:number)=>rule({id,type:'premium',allowance:undefined,premium:{normalField:'regularPremium',earlyField:'earlyPremium',coefficient,condition:condition('monthly.earlySessions',2,'gte')}});
  const rules=[rule(),rule({id:'b',scope:'employees',employeeCondition:condition('employee.nonCompeteSigned',true),allowance:{field:'nightSessions',amount:10}}),premium('c',1.2),premium('d',1.5),hourly('floor',[flat('f',60,'guarantee')],'hours',true),hourly('add',[flat('m',30)]),hourly('room',[flat('n',50)]),hourly('night',[flat('night',10)],'nightHours')];
  rules[6]={...rules[6],scope:'rooms',roomIds:['r1']};
  const source=[row()],before=structuredClone(source); const result=calculate(rules,source);
  expect(result.referenceDate).toBe('2026-10-31'); expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({allowance:60,premium:{before:1000,early:200,regular:800,coefficient:1.5,after:1100,roiAfter:11},total:880});
  expect(result.rows[0].durationGroups).toMatchObject([{scope:'global',duration:'hours',guarantee:60,additions:30,rate:60,hours:10,amount:600},{scope:'rooms',duration:'hours',rate:50,hours:10,amount:500},{scope:'global',duration:'nightHours',rate:10,hours:2,amount:20}]);
  expect(result.salaries[0]).toMatchObject({employeeId:'e1',fixed:0,total:880});expect(source).toEqual(before);
 });
 it('uses effective ROI and recomputes room ranks after every coefficient, keeping rooms separate',()=>{
  const metric=hourly('rank',[{id:'rank',name:'排名',kind:'metric',field:'roiRank',bands:[band({keyType:'exact',min:undefined,exact:1,rate:80}),band({min:2,rate:20})]}]);
  const boost=rule({id:'boost',type:'premium',allowance:undefined,premium:{normalField:'regularPremium',earlyField:'earlyPremium',coefficient:3,condition:condition('monthly.earlySessions',2)}});
  const result=calculate([boost,metric],[row(),row({employeeId:'e2',premium:1200,earlyPremium:200,earlySessions:0})],[employee,{...employee,id:'e2',name:'乙'}]);
  expect(result.rows.map(r=>[r.premium.after,r.premium.rank,r.total])).toEqual([[1400,1,800],[1200,2,200]]);
  const roi=hourly('roi',[{id:'roi',name:'ROI',kind:'metric',field:'roi',bands:[band({min:11,rate:99})]}]);expect(calculate([boost,roi]).rows[0].total).toBe(990);
 });
 it('matches exact ROI ranks including ties and rejects duplicate or overlapping exact bands',()=>{
  const exact=(rank:number,rate:number):NewRuleBand=>({keyType:'exact',exact:rank,includeMin:true,includeMax:true,rate});
  const rankRule=hourly('ranks',[{id:'rank',name:'排名时薪',kind:'metric',field:'roiRank',bands:[exact(1,80),exact(2,60),exact(3,40)]}]);
  rankRule.definitionVersion=2;rankRule.hourly!.kind='metric';
  const inputs=[row(),row({employeeId:'e2'}),row({employeeId:'e3',premium:800})];
  const result=calculate([rankRule],inputs,[employee,{...employee,id:'e2',name:'乙'},{...employee,id:'e3',name:'丙'}]);
  expect(result.rows.map(trace=>[trace.premium.rank,trace.durationGroups[0].items[0].rate,trace.total])).toEqual([[1,80,800],[1,80,800],[3,40,400]]);
  for(const bands of [[exact(1,80),exact(1,60)],[exact(1,80),band({min:1,max:3,rate:60})]]){
   const invalid=structuredClone(rankRule);invalid.hourly!.items[0].bands=bands;
   expect(()=>validateCompensationRule(invalid)).toThrow(/重叠/);
  }
 });
 it('uses calendar month inclusive dates with clamped days and excludes future dates',()=>{
  const scoped=rule({scope:'employees',employeeCondition:{kind:'group',operator:'or',children:[condition('employee.nonCompeteSigned',false),condition('employee.joined',3,'withinMonths')]}});
  expect(matchesCompensationRule(scoped,row(),[employee],[room],'2026-10')).toBe(true);
  expect(matchesCompensationRule(scoped,row(),[{...employee,joined:'2026-07-30'}],[room],'2026-10')).toBe(false);
  expect(matchesCompensationRule(scoped,row(),[{...employee,joined:'2026-11-01'}],[room],'2026-10')).toBe(false);
  expect(referenceDateForMonth('2024-02')).toBe('2024-02-29');expect(()=>referenceDateForMonth('2026-13')).toThrow();
  expect(matchesCompensationRule({...scoped,employeeCondition:condition('employee.joined',3,'withinMonths')},row({month:'2026-04'}),[{...employee,joined:'2026-01-31'}],[room],'2026-04')).toBe(true);
 });
 it('blocks required missing dates or metrics even inside an alternative condition',()=>{
  const scoped=rule({scope:'employees',employeeCondition:{kind:'group',operator:'or',children:[condition('employee.nonCompeteSigned',true),condition('employee.joined',3,'withinMonths')]}});
  expect(()=>matchesCompensationRule(scoped,row(),[{...employee,joined:''}],[room],'2026-10')).toThrow(/日期|缺失/);
  expect(()=>calculate([rule({type:'premium',allowance:undefined,premium:{normalField:'regularPremium',earlyField:'earlyPremium',coefficient:1.5,condition:condition('monthly.earlySessions',2)}})],[row({earlyPremium:undefined})])).toThrow(/早班|缺失/);
  expect(()=>calculate([hourly('roi',[{id:'x',name:'X',kind:'metric',field:'roi',bands:[band()]}])],[row({spend:0})])).toThrow(/ROI|消耗/);
 });
 it('rejects unknown/type-invalid ASTs, empty scopes, invalid formulas and unsafe premium conditions',()=>{
  for(const value of [rule({scope:'rooms'}),rule({scope:'employees',employeeCondition:condition('employee.joined','1','withinMonths')}),rule({scope:'employees',employeeCondition:condition('employee.nope',true)}),rule({scope:'employees',employeeCondition:condition('employee.nonCompeteSigned','true')}),rule({type:'premium',allowance:undefined,premium:{normalField:'regularPremium',earlyField:'earlyPremium',coefficient:1.5,condition:condition('monthly.roi',2)}}),hourly('bad',[flat('x',5,'guarantee')]),hourly('duplicate',[flat('x',2),flat('x',3)])]) expect(()=>validateCompensationRule(value)).toThrow();
 });
 it('rejects unknown employee selectors even when nested in valid alternatives and allows the confirmed employee-only selector',()=>{
  expect(()=>validateCompensationRule(rule({scope:'employees',employeeCondition:condition('employee.nonCompeteSigned',true)}))).not.toThrow();
  const unknown:ConditionGroup={kind:'group',operator:'or',children:[condition('employee.nonCompeteSigned',true),condition('employee.unlistedFlag',true)]};
  expect(()=>validateCompensationRule(rule({scope:'employees',employeeCondition:unknown}))).toThrow(/字段/);
  expect(()=>validateCompensationRule(rule({scope:'employees',employeeCondition:condition('monthly.roi',2)}))).toThrow(/字段/);
  expect(()=>validateCompensationRule(rule({scope:'employees',employeeCondition:{kind:'group',operator:'and',children:[{kind:'script',field:'employee.id',operator:'eq',value:'e1'} as never]}}))).toThrow(/类型/);
 });
 it('rejects overlapping or runtime multi-field band matches instead of guessing',()=>{
  expect(()=>validateCompensationRule(hourly('x',[{id:'x',name:'x',kind:'metric',field:'roi',bands:[band(),band({min:1})]}]))).toThrow(/重叠/);
  const cross=hourly('x',[{id:'x',name:'x',kind:'metric',field:'roi',bands:[band(),band({keyType:'related',relatedField:'earlySessions'})]}]);
  expect(()=>calculate([cross])).toThrow(/多|唯一/);
  expect(()=>calculate([hourly('x',[{id:'x',name:'x',kind:'metric',field:'roi',bands:[band({min:20})]}])])).toThrow(/未命中/);
 });
 it('blocks bad numbers, duplicate row grains, context/version drift and overflows',()=>{
  for(const hours of [-1,NaN,Infinity,null as unknown as number]) expect(()=>calculate([hourly('h',[flat('a',1)])],[row({hours})])).toThrow();
  expect(()=>calculate([rule()],[row(),row()])).toThrow(/重复/);
  expect(()=>calculate([rule(),rule({version:2})])).toThrow(/重复|版本/);
  expect(()=>calculate([rule()],[row({departmentId:'missing'})])).toThrow(/部门/);
  expect(()=>calculate([hourly('overflow',[flat('x',1e308)])])).toThrow(/无效|溢出/);
  expect(()=>calculate([rule({allowance:{field:'nightSessions',amount:NaN}})])).toThrow();
 });
 it('validates present raw numeric fields and unknown context instead of hiding bad data behind unused fields',()=>{
  expect(()=>calculate([hourly('flat',[flat('x',10)])],[row({nightSessions:-1})])).toThrow();
  expect(()=>calculate([rule()],[row({earlySpend:NaN})])).toThrow();
  expect(()=>calculate([rule()],[row({employeeId:'missing'})])).toThrow();
  expect(()=>calculate([rule()],[row({earlyPremium:1001})])).toThrow();
  expect(()=>calculate([hourly('flat',[flat('x',10)])],[row({hours:4,nightHours:2,earlyHours:3})])).toThrow();
 });
 it('preserves room-specific max comparisons and excludes rows without the host role',()=>{
  const result=calculate([hourly('a',[flat('x',20)]),hourly('floor',[flat('f',50,'guarantee')],'hours',true)],
   [row(),row({roomId:'r2',premium:2000}),row({employeeId:'e2',roles:['投手']}),row({employeeId:'e3',roles:['场控']})],
   [employee,{...employee,id:'e2',name:'乙'},{...employee,id:'e3',name:'丙'}],[room,{...room,id:'r2',name:'二'}]);
  expect(result.rows).toHaveLength(2);expect(result.salaries.map(s=>s.total)).toEqual([1000]);
  expect(result.rows.map(r=>r.premium.rank)).toEqual([1,1]);
 });
 it('supports room date guarantee conditions and records complete evidence for failed alternatives',()=>{
  const item={...flat('f',60,'guarantee'),condition:{kind:'group' as const,operator:'or' as const,children:[condition('employee.nonCompeteSigned',false),condition('room.openedOn',3,'withinMonths')]}};
  const result=calculate([hourly('date',[item],'hours',true)]);
  expect(result.rows[0].total).toBe(600);expect(result.rows[0].conditions[0]).toMatchObject({ruleId:'date',itemId:'f',matched:true,values:{'employee.nonCompeteSigned':true,'room.openedOn':'2026-07-31'}});
  expect(()=>calculate([hourly('date',[item],'hours',true)],[row()],[employee],[{...room,openedOn:undefined} as LiveRoom])).toThrow(/日期/);
 });
 it('ignores drafts and inactive staff, supports zero hours, and derives regular values without guessing early contributions',()=>{
  expect(calculate([rule({status:'草稿'})]).rows).toEqual([]);
  expect(calculate([rule()],[row()],[{...employee,status:'已离职'}]).rows).toEqual([]);
  expect(calculate([hourly('normal',[flat('x',20)],'regularHours')]).rows[0].total).toBe(100);
  expect(calculate([hourly('zero',[flat('x',20)])],[row({hours:0,nightHours:0,earlyHours:0,regularHours:0})]).rows[0].total).toBe(0);
  expect(calculate([rule()],[row({earlyPremium:undefined,regularPremium:undefined})]).rows[0].allowance).toBe(40);
 });
});

it('正常保费排除夜班与早班，系数规则有效保费不计入夜班且正常项不重复扣减',()=>{
 const premium=rule({id:'p',type:'premium',allowance:undefined,premium:{normalField:'regularPremium',earlyField:'earlyPremium',coefficient:1.5,condition:condition('monthly.earlySessions',1,'gte')}});
 const normal=hourly('normal',[{id:'normal',name:'正常保费档位',kind:'metric',field:'regularPremium',bands:[band({keyType:'exact',min:undefined,exact:700,rate:80})]}]);
 const result=calculate([premium,normal],[row({nightPremium:100})]);
 expect(result.rows[0]).toMatchObject({premium:{before:1000,regular:700,early:200,after:1000},total:800});
 const unchanged=calculate([premium],[row({nightPremium:100,earlySessions:0})]);
 expect(unchanged.rows[0].premium.after).toBe(900);
});

describe('configurable compensation definitions',()=>{
 it('等待薪资天数可作为计数和条件指标，未填写时阻止引用，零天合法',()=>{
  expect(allowanceCountOptions).toContainEqual({field:'waitingSalaryDays',label:'等待薪资天数',type:'number'});
  expect(conditionFieldOptions).toContainEqual({field:'monthly.waitingSalaryDays',label:'等待薪资天数',type:'number'});
  const configured=rule({definitionVersion:2,allowance:{field:'waitingSalaryDays',amount:30}});
  expect(calculate([configured],[row({waitingSalaryDays:12})]).rows[0]).toMatchObject({allowance:360,allowanceItems:[{field:'waitingSalaryDays',sessions:12,amount:360}]});
  expect(calculate([configured],[row({waitingSalaryDays:0})]).rows[0].allowance).toBe(0);
  expect(()=>calculate([configured])).toThrow(/等待薪资天数.*缺失/);
  expect(()=>calculate([rule()])).not.toThrow();
  const guarantee=hourly('waiting',[{...flat('wait',60,'guarantee'),condition:condition('monthly.waitingSalaryDays',10,'gte')}],'hours',true);
  expect(calculate([guarantee],[row({waitingSalaryDays:12})]).rows[0].total).toBe(600);
  expect(()=>calculate([guarantee])).toThrow(/等待薪资天数.*缺失/);
  expect(()=>calculate([guarantee],[row({waitingSalaryDays:1.5})])).toThrow(/整数/);
 });
 it('uses the selected count metric for allowances and records its source',()=>{
  const configured=rule({definitionVersion:2,allowance:{field:'earlySessions',amount:30}});
  const result=calculate([configured],[row({nightSessions:2,earlySessions:5})]);
  expect(result.rows[0].allowance).toBe(150);
  expect(result.rows[0].allowanceItems[0]).toMatchObject({field:'earlySessions',sessions:5,rate:30,amount:150});
  expect(()=>calculate([configured],[row({earlySessions:1.5})])).toThrow(/计数|整数/);
  expect(()=>validateCompensationRule({...configured,allowance:{field:'roi' as never,amount:30}})).toThrow();
 });
 it('calculates each premium formula from raw fields then picks the highest total before hourly ROI evaluation',()=>{
  const item=(id:string,field:'regularPremium'|'earlyPremium'|'premium',coefficient:number)=>({id,name:id,field,coefficient});
  const a=rule({id:'p1',definitionVersion:2,type:'premium',allowance:undefined,premium:{items:[item('正常','regularPremium',1),item('早班','earlyPremium',2)]}});
  const b=rule({id:'p2',definitionVersion:2,type:'premium',allowance:undefined,premium:{items:[item('总额','premium',1.05)]}});
  const metric=hourly('h',[{id:'roi',name:'ROI加成',kind:'metric',field:'roi',bands:[band({min:10.9,max:11.1,rate:80})]}]);
  const source=row({nightPremium:100});
  const result=calculate([a,b,metric],[source]);
  expect(result.rows[0].premium).toMatchObject({before:1000,after:1100,roiAfter:11,candidates:[{ruleId:'p1',amount:1100,selected:true},{ruleId:'p2',amount:1050,selected:false}]});
  expect(result.rows[0].total).toBe(800);
  expect(source.premium).toBe(1000);
 });
 it('does not add omitted premium fields and applies coefficients once, including zero',()=>{
  const configured=rule({definitionVersion:2,type:'premium',allowance:undefined,premium:{items:[{id:'early',name:'早班',field:'earlyPremium',coefficient:0}]}});
  expect(calculate([configured]).rows[0].premium.after).toBe(0);
  expect(()=>validateCompensationRule({...configured,premium:{items:[]}})).toThrow(/系数项/);
  expect(()=>validateCompensationRule({...configured,premium:{items:[{id:'bad',name:'错误',field:'spend' as never,coefficient:1}]}})).toThrow(/保费/);
 });
 it('validates a single hourly subtype and includes all metric items in its automatic formula',()=>{
  const configured=hourly('h',[{id:'a',name:'A',kind:'metric',field:'roi',bands:[band({rate:20})]},{id:'b',name:'B',kind:'metric',field:'hourlySpend',bands:[band({rate:10})]}]);
  configured.definitionVersion=2;configured.hourly!.kind='metric';
  expect(calculate([configured]).rows[0].total).toBe(300);
  expect(()=>validateCompensationRule({...configured,hourly:{...configured.hourly!,formula:{mode:'additions',itemIds:['a']}}})).toThrow(/公式/);
  expect(()=>validateCompensationRule({...configured,hourly:{...configured.hourly!,items:[...configured.hourly!.items,flat('special',20)]}})).toThrow(/类型/);
  const guarantee=hourly('g',[{...flat('g',60,'guarantee'),condition:condition('employee.nonCompeteSigned',true)}],'nightHours',true);guarantee.definitionVersion=2;guarantee.hourly!.kind='guarantee';
  expect(calculate([guarantee]).rows[0].total).toBe(120);
  expect(()=>validateCompensationRule({...guarantee,hourly:{...guarantee.hourly!,items:[flat('g',60,'guarantee')]}})).toThrow(/保薪.*条件/);
 });
});
