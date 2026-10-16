import { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../components';
import { compensationMetricOptions, validateBands, type CompensationMetric, type NewRuleBand } from '../compensation-rules';
import { editableHourlyBand } from './compensation-definition';

export const blankHourlyBand=():NewRuleBand=>({keyType:'range',min:0,includeMin:true,includeMax:false,rate:0});
const numeric=(value:string)=>value===''?undefined:Number(value);
const display=(value?:number)=>value!==undefined&&Number.isFinite(value)?value:'';

export function hourlyBandSummary(field:string,band:NewRuleBand):string {
 const metric=band.keyType==='related'?band.relatedField:field;
 const label=compensationMetricOptions.find(option=>option.field===metric)?.label||metric||'未选指标';
 const value=(n?:number)=>display(n)===''?'未填写':String(n);
 let condition:string;
 if(band.keyType==='exact')condition=`${label} = ${value(band.exact)}`;
 else if(band.min!==undefined&&band.max!==undefined)condition=`${value(band.min)} ${band.includeMin?'≤':'<'} ${label} ${band.includeMax?'≤':'<'} ${value(band.max)}`;
 else if(band.min!==undefined)condition=`${label} ${band.includeMin?'≥':'>'} ${value(band.min)}`;
 else if(band.max!==undefined)condition=`${label} ${band.includeMax?'≤':'<'} ${value(band.max)}`;
 else condition=`${label} · 范围未填写`;
 return `${band.keyType==='related'?'关联 ':''}${condition} → ${value(band.rate)} 元/小时`;
}

export default function HourlyBandEditor({field,bands,onChange,readOnly=false,initialExpandedIndex=null}:{field:string;bands:NewRuleBand[];onChange:(bands:NewRuleBand[])=>void;readOnly?:boolean;initialExpandedIndex?:number|null}) {
 const [expanded,setExpanded]=useState<number|null>(initialExpandedIndex),[error,setError]=useState('');
 const id=useId();
 const change=(index:number,patch:Partial<NewRuleBand>)=>{setError('');onChange(bands.map((band,i)=>i===index?{...editableHourlyBand(band),...patch}:band))};
 const finish=(checkAll=true)=>{
  if(expanded===null)return true;
  try{validateBands({id:'draft',name:'档位',kind:'metric',field,bands:checkAll?bands:[bands[expanded]]});setError('');return true}
  catch(cause){setError(cause instanceof Error?cause.message:'请核对档位配置');return false}
 };
 const add=()=>{if(finish()){setExpanded(bands.length);onChange([...bands,blankHourlyBand()])}};
 const remove=(index:number)=>{
  onChange(bands.filter((_,i)=>i!==index));setError('');
  setExpanded(current=>current===null||current===index?null:current>index?current-1:current);
 };
 return <fieldset className="hourly-band-editor" disabled={readOnly}>
  <strong>时薪档位</strong><p className="caption">范围可开放一侧边界；每个项目须唯一命中档位。</p>
  {bands.map((source,index)=>{
   const band=readOnly?source:editableHourlyBand(source);
   const open=!readOnly&&expanded===index,controlsId=`${id}-band-${index}`;
   return <div className={`definition-band hourly-band ${open?'is-expanded':'is-collapsed'}`} key={index}>
    <div className="hourly-band-heading"><strong>档位 {index+1}</strong><span className="hourly-band-summary" title={hourlyBandSummary(field,band)}>{hourlyBandSummary(field,band)}</span>{!readOnly&&<div className="hourly-band-actions">
     {open?<Button onClick={()=>{if(finish())setExpanded(null)}}>完成</Button>:<button type="button" className="button" aria-label={`编辑档位${index+1}`} aria-expanded={false} aria-controls={controlsId} onClick={()=>{if(finish(false))setExpanded(index)}}>编辑</button>}
     <button type="button" className="icon-button" aria-label={`删除档位${index+1}`} onClick={()=>remove(index)}><Trash2 size={14}/></button>
    </div>}</div>
    {open&&<div id={controlsId} className="hourly-band-details">
     <div className="definition-band-fields">
      <label>匹配方式<select autoFocus aria-label={`档位${index+1}匹配方式`} value={band.keyType} onChange={e=>change(index,{keyType:e.target.value as NewRuleBand['keyType'],exact:undefined,min:0,max:undefined,relatedField:e.target.value==='related'?compensationMetricOptions.find(o=>o.field!==field)?.field:undefined})}><option value="range">数值范围</option><option value="related">关联指标范围</option></select></label>
      {band.keyType==='related'&&<label>关联指标<select aria-label={`档位${index+1}关联指标`} value={band.relatedField||''} onChange={e=>change(index,{relatedField:e.target.value as CompensationMetric})}>{compensationMetricOptions.filter(o=>o.field!==field).map(o=><option key={o.field} value={o.field}>{o.label}</option>)}</select></label>}
      <label>下限（留空不限制）<input aria-label={`档位${index+1}下限`} type="number" step="any" value={display(band.min)} onChange={e=>change(index,{min:numeric(e.target.value)})}/></label>
      <label>上限（留空不限制）<input aria-label={`档位${index+1}上限`} type="number" step="any" value={display(band.max)} onChange={e=>change(index,{max:numeric(e.target.value)})}/></label><label>范围边界<select aria-label={`档位${index+1}范围边界`} value={`${band.includeMin?1:0}${band.includeMax?1:0}`} onChange={e=>change(index,{includeMin:e.target.value[0]==='1',includeMax:e.target.value[1]==='1'})}><option value="10">[下限, 上限)</option><option value="11">[下限, 上限]</option><option value="00">(下限, 上限)</option><option value="01">(下限, 上限]</option></select></label>
      <label>时薪（元 / 小时）<input aria-label={`档位${index+1}时薪`} type="number" min="0" step="any" value={display(band.rate)} onChange={e=>change(index,{rate:numeric(e.target.value)??NaN})}/></label>
     </div>{error&&<p className="rule-error" role="alert">{error}</p>}
    </div>}
   </div>;
  })}
  {!readOnly&&<div className="hourly-band-add"><Button onClick={add}><Plus size={14}/>新增档位</Button></div>}
 </fieldset>;
}
