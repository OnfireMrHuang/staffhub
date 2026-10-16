import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Modal } from '../components';
import { allowanceCountOptions, blankConditionGroup, compensationMetricOptions, conditionFieldOptions, durationOptions, premiumFieldOptions, validateCompensationRule, type CalculationType, type CompensationRule, type CountMetric, type HourlyItem, type PremiumField } from '../compensation-rules';
import ConditionBuilder from './ConditionBuilder';
import HourlyBandEditor, { blankHourlyBand } from './HourlyBandEditor';
import { calculationLabels, compensationExpression, compensationMetricLabel, displayNumber, hourlyKindLabels, numberValue, uid, withHourlyItems, withHourlyKind, withType } from './compensation-definition';

export default function CompensationRuleDefinition({rule,onChange,readOnly=false}:{rule:CompensationRule;onChange:(rule:CompensationRule)=>void;readOnly?:boolean}) {
 const [editing,setEditing]=useState<HourlyItem|null>(null),[itemError,setItemError]=useState(''),[expandFirstBand,setExpandFirstBand]=useState(false);
 const hourly=rule.hourly,kind=hourly?.kind||hourly?.items[0]?.kind||'metric';
 const updateSingle=(patch:Partial<HourlyItem>)=>{if(hourly?.items[0])onChange(withHourlyItems(rule,[{...hourly.items[0],...patch}]))};
 const saveItem=()=>{
  if(!editing||!hourly)return;
  try{
   validateCompensationRule({...rule,name:rule.name||'指标配置',version:Math.max(1,rule.version),scope:'global',roomIds:[],employeeCondition:undefined,hourly:{...hourly,kind:'metric',items:[editing],formula:{mode:'additions',itemIds:[editing.id]}}});
   onChange(withHourlyItems(rule,hourly.items.some(item=>item.id===editing.id)?hourly.items.map(item=>item.id===editing.id?editing:item):[...hourly.items,editing]));setEditing(null);
  }catch(error){setItemError(error instanceof Error?error.message:'请核对统计指标配置')}
 };
 return <section className="compensation-rule-definition" aria-label="规则定义">
  <div className="compensation-definition-basics"><label>规则名称<input aria-label="规则名称" value={rule.name} onChange={e=>onChange({...rule,name:e.target.value})}/></label><label>计算类型<select aria-label="计算类型" value={rule.type} onChange={e=>onChange(withType(rule,e.target.value as CalculationType))}>{Object.entries(calculationLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>
  {rule.type==='allowance'&&rule.allowance&&<div className="compensation-definition-basics">
   <label>计数指标<select aria-label="补贴计数指标" value={rule.allowance.field} onChange={e=>onChange({...rule,allowance:{...rule.allowance!,field:e.target.value as CountMetric}})}>{allowanceCountOptions.map(option=><option key={option.field} value={option.field}>{option.label}</option>)}</select></label>
   <label>补贴金额（元 / 次）<input aria-label="补贴金额" type="number" min="0" step="any" value={displayNumber(rule.allowance.amount)} onChange={e=>onChange({...rule,allowance:{...rule.allowance!,amount:numberValue(e.target.value)}})}/></label>
  </div>}
  {rule.type==='premium'&&rule.premium&&('items' in rule.premium?<section>
   <div className="inline"><h3>系数项</h3><span className="spacer"/>{!readOnly&&<Button onClick={()=>{if(rule.premium&&'items' in rule.premium)onChange({...rule,premium:{items:[...rule.premium.items,{id:uid(),name:'',field:'earlyPremium',coefficient:1}]}})}}><Plus size={14}/>新增系数项</Button>}</div>
   {rule.premium.items.map((item,index)=><article className="premium-definition-item" key={item.id}><div className="compensation-form-row">
    <label>名称<input aria-label={`系数项${index+1}名称`} value={item.name} onChange={e=>{if(rule.premium&&'items' in rule.premium)onChange({...rule,premium:{items:rule.premium.items.map(i=>i.id===item.id?{...i,name:e.target.value}:i)}})}}/></label>
    <label>保费字段<select aria-label={`系数项${index+1}保费字段`} value={item.field} onChange={e=>{if(rule.premium&&'items' in rule.premium)onChange({...rule,premium:{items:rule.premium.items.map(i=>i.id===item.id?{...i,field:e.target.value as PremiumField}:i)}})}}>{premiumFieldOptions.map(option=><option key={option.field} value={option.field}>{option.label}</option>)}</select></label>
    <label>保费系数<input aria-label={`系数项${index+1}保费系数`} type="number" min="0" step="any" value={displayNumber(item.coefficient)} onChange={e=>{if(rule.premium&&'items' in rule.premium)onChange({...rule,premium:{items:rule.premium.items.map(i=>i.id===item.id?{...i,coefficient:numberValue(e.target.value)}:i)}})}}/></label>
   </div>{!readOnly&&<button type="button" className="icon-button" aria-label={`删除系数项${index+1}`} onClick={()=>{if(rule.premium&&'items' in rule.premium)onChange({...rule,premium:{items:rule.premium.items.filter(i=>i.id!==item.id)}})}}><Trash2 size={15}/></button>}</article>)}
   <h3>保费计算公式</h3><div className="expression-display">{compensationExpression(rule)}</div>
  </section>:<section><h3>原保费配置</h3><div className="expression-display">正常保费 + 早班保费 × {rule.premium.coefficient}</div><ConditionBuilder label="原早班场次条件" fields={conditionFieldOptions.filter(field=>field.field==='monthly.earlySessions')} value={rule.premium.condition} readOnly onChange={()=>{}}/></section>)}
  {rule.type==='hourly'&&hourly&&<>
   <div className="compensation-definition-basics"><label>计薪时长<select aria-label="计薪时长" value={hourly.duration} onChange={e=>onChange({...rule,hourly:{...hourly,duration:e.target.value as typeof hourly.duration}})}>{durationOptions.map(option=><option key={option.field} value={option.field}>{option.label}</option>)}</select></label><label>时薪计算类型<select aria-label="时薪计算类型" value={kind} onChange={e=>{setEditing(null);onChange(withHourlyKind(rule,e.target.value as HourlyItem['kind']))}}>{Object.entries(hourlyKindLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>
   {(kind==='metric'||(readOnly&&!hourly.kind))&&<section><div className="inline"><h3>统计指标列表</h3><span className="spacer"/>{!readOnly&&<Button onClick={()=>{setItemError('');setExpandFirstBand(true);setEditing({id:uid(),name:'',kind:'metric',field:'roi',bands:[blankHourlyBand()]})}}><Plus size={14}/>新增统计指标</Button>}</div>
    {!hourly.items.length&&<p className="caption">尚未添加统计指标</p>}
    {hourly.items.map(item=><section key={item.id}><article className="hourly-metric-summary"><div><strong>{item.name}</strong><small>{item.field?compensationMetricLabel(item.field):hourlyKindLabels[item.kind]}{item.bands?` · ${item.bands.length} 个档位`:item.rate!==undefined?` · ${item.rate} 元 / 小时`:''}</small></div>{!readOnly&&<Button onClick={()=>{setItemError('');setExpandFirstBand(false);setEditing(structuredClone(item))}}>编辑</Button>}{!readOnly&&<button type="button" className="icon-button" aria-label={`删除统计指标${item.name}`} onClick={()=>onChange(withHourlyItems(rule,hourly.items.filter(i=>i.id!==item.id)))}><Trash2 size={15}/></button>}</article>{readOnly&&item.bands&&<HourlyBandEditor field={item.field||'roi'} bands={item.bands} readOnly onChange={()=>{}}/>}{readOnly&&item.condition&&<ConditionBuilder label={`${item.name}条件`} value={item.condition} readOnly onChange={()=>{}}/>}</section>)}
   </section>}
   {kind==='special'&&hourly.kind&&<label>加成金额（元 / 小时）<input aria-label="加成金额" type="number" min="0" step="any" value={displayNumber(hourly.items[0]?.rate)} onChange={e=>updateSingle({rate:numberValue(e.target.value)})}/></label>}
   {kind==='guarantee'&&hourly.kind&&<><ConditionBuilder label="保薪条件" value={hourly.items[0]?.condition||blankConditionGroup()} onChange={condition=>updateSingle({condition})} readOnly={readOnly}/><label>保薪值（元 / 小时）<input aria-label="保薪值" type="number" min="0" step="any" value={displayNumber(hourly.items[0]?.rate)} onChange={e=>updateSingle({rate:numberValue(e.target.value)})}/></label></>}
   <h3>计算公式</h3><div className="expression-display">{compensationExpression(rule)}</div>
  </>}
  {rule.type==='allowance'&&<div className="expression-display">{compensationExpression(rule)}</div>}
  {editing&&<Modal open onOpenChange={open=>!open&&setEditing(null)} title={readOnly?'统计项目详情':'统计指标配置'} description="名称、统计指标与时薪档位" wide><fieldset className="department-rule-form compensation-form" disabled={readOnly}><div className="compensation-definition-basics"><label>名称<input aria-label="统计指标名称" value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>{editing.kind==='metric'&&<label>统计指标<select aria-label="统计指标字段" value={editing.field||'roi'} onChange={e=>{setExpandFirstBand(true);setEditing({...editing,field:e.target.value,bands:[blankHourlyBand()]})}}>{compensationMetricOptions.map(option=><option key={option.field} value={option.field}>{option.label}</option>)}</select></label>}</div>{editing.kind==='metric'?<HourlyBandEditor key={`${editing.id}-${editing.field}`} field={editing.field||'roi'} bands={editing.bands||[]} initialExpandedIndex={expandFirstBand?0:null} readOnly={readOnly} onChange={bands=>setEditing({...editing,bands})}/>:<p>{hourlyKindLabels[editing.kind]} · {editing.rate} 元 / 小时</p>}{editing.condition&&<ConditionBuilder label="触发条件" value={editing.condition} readOnly onChange={()=>{}}/>}</fieldset>{itemError&&<p className="rule-error" role="alert">{itemError}</p>}<div className="dialog-foot"><Button onClick={()=>setEditing(null)}>{readOnly?'关闭':'取消'}</Button>{!readOnly&&<Button variant="primary" onClick={saveItem}>保存统计指标</Button>}</div></Modal>}
 </section>;
}
