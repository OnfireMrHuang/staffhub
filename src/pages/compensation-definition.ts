import { blankConditionGroup, compensationMetricOptions, type CalculationType, type CompensationRule, type HourlyItem, type Scope } from '../compensation-rules';
export const scopeLabels:Record<Scope,string>={global:'全局规则',rooms:'直播间规则',employees:'员工规则'};
export const calculationLabels:Record<CalculationType,string>={allowance:'补贴规则',premium:'保费系数规则',hourly:'时薪规则'};
export const hourlyKindLabels:Record<HourlyItem['kind'],string>={metric:'统计指标加成',special:'特殊时段加成',guarantee:'条件保薪'};
export const compensationMetricLabel=(field:string)=>compensationMetricOptions.find(o=>o.field===field)?.label||field;
export const numberValue=(v:string)=>v===''?NaN:Number(v);
export const displayNumber=(v?:number)=>v!==undefined&&Number.isFinite(v)?v:'';
export const uid=()=>crypto.randomUUID();
export function createCompensationRule(scope:Scope):CompensationRule {
 return {id:`compensation-${uid()}`,name:'',version:0,status:'草稿',definitionVersion:2,scope,roomIds:[],...(scope==='employees'?{employeeCondition:blankConditionGroup()}:{}),type:'allowance',allowance:{field:'nightSessions',amount:20}};
}
export function withHourlyKind(rule:CompensationRule,kind:HourlyItem['kind']):CompensationRule {
 const items:HourlyItem[]=kind==='metric'?[]:[{id:uid(),name:hourlyKindLabels[kind],kind,rate:0,...(kind==='guarantee'?{condition:blankConditionGroup()}:{} )}];
 return {...rule,definitionVersion:2,hourly:{duration:rule.hourly?.duration||'hours',kind,items,formula:kind==='guarantee'?{mode:'guarantee',itemId:items[0].id}:{mode:'additions',itemIds:items.map(item=>item.id)}}};
}
export function withType(rule:CompensationRule,type:CalculationType):CompensationRule {
 const {allowance:_,premium:__,hourly:___,...base}=rule;
 if(type==='allowance')return {...base,definitionVersion:2,type,allowance:{field:'nightSessions',amount:20}};
 if(type==='premium')return {...base,definitionVersion:2,type,premium:{items:[{id:uid(),name:'正常保费',field:'regularPremium',coefficient:1},{id:uid(),name:'早班保费',field:'earlyPremium',coefficient:1.2}]}};
 return withHourlyKind({...base,type},'metric');
}
export function withHourlyItems(rule:CompensationRule,items:HourlyItem[]):CompensationRule {
 const config=rule.hourly!;
 return {...rule,hourly:{...config,items,formula:config.kind==='guarantee'?{mode:'guarantee',itemId:items[0]?.id||''}:{mode:'additions',itemIds:items.map(item=>item.id)}}};
}
export function editableCompensationRule(source:CompensationRule):CompensationRule {
 const rule=structuredClone(source);
 if(rule.definitionVersion===2)return rule;
 rule.definitionVersion=2;
 if(rule.type==='premium'&&rule.premium&&!('items' in rule.premium))rule.premium={items:[{id:uid(),name:'正常保费',field:'regularPremium',coefficient:1},{id:uid(),name:'早班保费',field:'earlyPremium',coefficient:rule.premium.coefficient}]};
 if(rule.type==='hourly'&&rule.hourly){
  const ids=rule.hourly.formula.mode==='guarantee'?[rule.hourly.formula.itemId]:rule.hourly.formula.itemIds;
  const active=ids.map(id=>rule.hourly!.items.find(item=>item.id===id)).filter((item):item is HourlyItem=>!!item);
  const kind=active[0]?.kind||'metric';
  rule.hourly.kind=kind;
  const items=active.filter(item=>item.kind===kind).slice(0,kind==='metric'?undefined:1);
  if(kind!=='guarantee')items.forEach(item=>{delete item.condition});
  if(kind==='guarantee'&&items[0]&&!items[0].condition)items[0].condition=blankConditionGroup();
  return withHourlyItems(rule,items);
 }
 return rule;
}
export function compensationExpression(rule:CompensationRule):string {
 if(rule.type==='allowance')return `${compensationMetricLabel(rule.allowance?.field||'nightSessions')} × ${rule.allowance?.amount??0} 元`;
 if(rule.type==='premium')return rule.premium&&'items' in rule.premium?rule.premium.items.map(item=>item.name||'未命名系数项').join(' + ')||'尚未添加系数项':`正常保费 + 早班保费 × ${(rule.premium as {coefficient:number}|undefined)?.coefficient??1}`;
 const hourly=rule.hourly;if(!hourly)return '尚未配置时薪';
 if(rule.definitionVersion===2&&hourly.kind&&hourly.kind!=='metric')return `${displayNumber(hourly.items[0]?.rate)} 元 / 小时 × ${compensationMetricLabel(hourly.duration)}`;
 const ids=hourly.formula.mode==='guarantee'?[hourly.formula.itemId]:hourly.formula.itemIds;
 const selected=ids.map(id=>hourly.items.find(item=>item.id===id)?.name||'未选项目').join(' + ')||'未选项目';
 return `${ids.length>1?`(${selected})`:selected} × ${compensationMetricLabel(hourly.duration)}`;
}
