import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Modal } from '../components';
import { validateCompensationRule, type CalculationType, type CompensationRule } from '../compensation-rules';
import type { LiveRoom } from '../operations-domain';
import { validateRoomRuleSet, type RoomRuleSet } from '../room-rule-sets';
import CompensationRoomPicker from './CompensationRoomPicker';
import CompensationRuleDefinition from './CompensationRuleDefinition';
import { calculationLabels, compensationExpression, createCompensationRule, editableCompensationRule, withType } from './compensation-definition';
import '../salary-rules.css';
import '../compensation-rules.css';

interface RoomRuleSetEditorProps {
 initial:RoomRuleSet;
 rooms:LiveRoom[];
 rules:CompensationRule[];
 readOnly?:boolean;
 onSave:(set:RoomRuleSet)=>void;
 onClose:()=>void;
}

/** Preserve untouched definitions while making room membership uniform for an atomic draft save. */
export function prepareRoomRuleSetDraft(source:RoomRuleSet):RoomRuleSet {
 const set=structuredClone(source);
 set.rules=set.rules.map(rule=>({...rule,scope:'rooms',roomIds:[...set.roomIds],roomRuleSetId:set.id}));
 validateRoomRuleSet({...set,rules:set.rules.map(rule=>({...rule,version:Math.max(1,rule.version)}))});
 return set;
}

export function RoomRuleSetForm({initial,rooms,rules,readOnly=false,onSave,onClose}:RoomRuleSetEditorProps) {
 const [set,setSet]=useState(()=>structuredClone(initial));
 const [expandedId,setExpandedId]=useState<string|null>(null);
 const [nextType,setNextType]=useState<CalculationType|''>('');
 const [error,setError]=useState('');
 const usedTypes=new Set(set.rules.map(rule=>rule.type));
 const pickerRule:CompensationRule={id:set.id,roomRuleSetId:set.id,name:'直播间规则集',version:1,status:'草稿',scope:'rooms',roomIds:set.roomIds,type:'allowance',allowance:{field:'nightSessions',amount:0}};
 const updateRule=(rule:CompensationRule)=>{setSet(current=>({...current,rules:current.rules.map(item=>item.id===rule.id?rule:item)}));setError('')};
 const editRule=(rule:CompensationRule)=>{
  if(!readOnly)updateRule(editableCompensationRule(rule));
  setExpandedId(rule.id);setError('');
 };
 const finishRule=(rule:CompensationRule)=>{
  try{
   validateCompensationRule({...rule,scope:'rooms',roomIds:set.roomIds,roomRuleSetId:set.id,version:Math.max(1,rule.version)});
   setExpandedId(null);setError('');
  }catch(cause){setError(cause instanceof Error?cause.message:'请完成子规则配置')}
 };
 const addRule=()=>{
  if(readOnly||!set.roomIds.length||!nextType||usedTypes.has(nextType))return;
  const rule={...withType(createCompensationRule('rooms'),nextType),roomRuleSetId:set.id,roomIds:[...set.roomIds]};
  setSet(current=>({...current,rules:[...current.rules,rule]}));setExpandedId(rule.id);setNextType('');setError('');
 };
 const removeRule=(id:string)=>{
  setSet(current=>({...current,rules:current.rules.filter(rule=>rule.id!==id)}));
  if(expandedId===id)setExpandedId(null);
  setError('');
 };
 const save=()=>{
  try{onSave(prepareRoomRuleSetDraft(set))}
  catch(cause){setError(cause instanceof Error?cause.message:'请核对规则集配置')}
 };
 return <div className="room-rule-set-editor">
  <div className="department-rule-form compensation-form">
   <CompensationRoomPicker rule={pickerRule} rooms={rooms} rules={rules} readOnly={readOnly} onChange={roomIds=>{setSet(current=>({...current,roomIds}));setError('')}}/>
   <section className="room-rule-set-children" aria-label="规则集子规则">
    <div className="room-rule-set-heading"><h3>计算规则</h3><span>{set.rules.length} / 3</span></div>
    {!set.rules.length&&<p className="caption">{set.roomIds.length?'选择计算类型，添加第一条规则。':'请先选择适用直播间，再添加计算规则。'}</p>}
    {set.rules.map(rule=>{
     const expanded=expandedId===rule.id;
     const original=initial.rules.find(item=>item.id===rule.id);
     const changedTemplate=original&&original.definitionVersion!==2&&original.type!=='allowance';
     return <article key={rule.id} className={`room-rule-set-child${expanded?' is-expanded':''}`}>
      <div className="room-rule-set-child-heading">
       <div className="room-rule-set-child-summary"><span>{calculationLabels[rule.type]}</span><strong>{rule.name||'未命名规则'}</strong><p>{compensationExpression(rule)}</p></div>
       <div className="room-rule-set-child-actions">
        <button type="button" className="button" aria-label={`${expanded?(readOnly?'收起':'完成'):(readOnly?'查看':'编辑')}${calculationLabels[rule.type]}`} aria-expanded={expanded} aria-controls={`room-rule-definition-${rule.id}`} onClick={()=>expanded?(readOnly?setExpandedId(null):finishRule(rule)):editRule(rule)}>{expanded?(readOnly?'收起':'完成'):(readOnly?'查看':'编辑')}</button>
        {!readOnly&&<button type="button" className="icon-button" aria-label={`删除${calculationLabels[rule.type]}`} onClick={()=>removeRule(rule.id)}><Trash2 size={15}/></button>}
       </div>
      </div>
      {expanded&&<div className="room-rule-set-child-definition" id={`room-rule-definition-${rule.id}`}>
       {!readOnly&&changedTemplate&&<p className="rule-template-note">保存后使用新模板：保费系数按系数项求和；时薪仅保留所选计算类型。原系数条件和加成触发条件不再使用，请核对配置。保存草稿不改变已发布版本，重新发布后供 HR 核算使用。</p>}
       <fieldset className="department-rule-form compensation-form" disabled={readOnly}><CompensationRuleDefinition rule={rule} onChange={updateRule} readOnly={readOnly} lockType/></fieldset>
      </div>}
     </article>;
    })}
    {!readOnly&&set.roomIds.length>0&&<div className="room-rule-set-add">
     <label>计算类型<select aria-label="新增规则计算类型" value={nextType} onChange={event=>setNextType(event.target.value as CalculationType|'')} disabled={usedTypes.size===3}>
      <option value="">{usedTypes.size===3?'已添加全部计算类型':'请选择计算类型'}</option>
      {Object.entries(calculationLabels).map(([type,label])=><option key={type} value={type} disabled={usedTypes.has(type as CalculationType)}>{label}{usedTypes.has(type as CalculationType)?'（已添加）':''}</option>)}
     </select></label>
     <Button onClick={addRule} disabled={!nextType||usedTypes.has(nextType)}><Plus size={14}/>添加规则</Button>
     <p className="caption">补贴、保费系数、时薪各最多一条，统一使用上方直播间。</p>
    </div>}
   </section>
  </div>
  {error&&<p className="rule-error" role="alert">{error}</p>}
  <div className="dialog-foot"><Button onClick={onClose}>{readOnly?'关闭':'取消'}</Button>{!readOnly&&<Button variant="primary" onClick={save}>保存草稿</Button>}</div>
 </div>;
}

export default function RoomRuleSetEditor(props:RoomRuleSetEditorProps) {
 const title=props.readOnly?'直播间规则集详情':props.initial.rules.some(rule=>rule.version>0)?'编辑直播间规则集':'新增直播间规则集';
 return <Modal open onOpenChange={open=>!open&&props.onClose()} title={title} description="先选择适用直播间，再配置补贴、保费系数和时薪。" wide><RoomRuleSetForm {...props}/></Modal>;
}
