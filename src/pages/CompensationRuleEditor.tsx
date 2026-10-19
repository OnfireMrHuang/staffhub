import { useState } from 'react';
import { Button, Modal } from '../components';
import { blankConditionGroup, conditionFieldOptions, validateCompensationRule, type CompensationRule } from '../compensation-rules';
import type { LiveRoom } from '../operations-domain';
import ConditionBuilder from './ConditionBuilder';
import CompensationRoomPicker from './CompensationRoomPicker';
import CompensationRuleDefinition from './CompensationRuleDefinition';
import { editableCompensationRule, scopeLabels } from './compensation-definition';
export { scopeLabels, calculationLabels, compensationExpression, compensationMetricLabel, createCompensationRule } from './compensation-definition';
export { default as CompensationRuleDefinition } from './CompensationRuleDefinition';
import '../salary-rules.css';
import '../compensation-rules.css';

export function CompensationRuleForm({rule,rooms,rules=[],onChange,readOnly=false}:{rule:CompensationRule;rooms:LiveRoom[];rules?:CompensationRule[];onChange:(rule:CompensationRule)=>void;readOnly?:boolean}) {
 return <fieldset className="department-rule-form compensation-form" disabled={readOnly}>
  <label>规则分类<input aria-label="规则分类" value={scopeLabels[rule.scope]} readOnly/></label>
  {rule.scope==='rooms'&&<CompensationRoomPicker rule={rule} rooms={rooms} rules={rules} readOnly={readOnly} onChange={roomIds=>onChange({...rule,roomIds})}/>}
  {readOnly&&rule.scope==='employees'&&<ConditionBuilder label="历史员工筛选条件" fields={conditionFieldOptions.filter(f=>f.field.startsWith('employee.'))} value={rule.employeeCondition||blankConditionGroup()} onChange={()=>{}} readOnly/>}
  <CompensationRuleDefinition rule={rule} onChange={onChange} readOnly={readOnly}/>
 </fieldset>;
}
export default function CompensationRuleEditor({initial,rooms,rules=[],readOnly=false,onSave,onClose}:{initial:CompensationRule;rooms:LiveRoom[];rules?:CompensationRule[];readOnly?:boolean;onSave:(rule:CompensationRule)=>void;onClose:()=>void}) {
 const [rule,setRule]=useState(()=>readOnly?structuredClone(initial):editableCompensationRule(initial)),[error,setError]=useState('');
 const save=()=>{try{validateCompensationRule({...rule,version:Math.max(1,rule.version)});onSave(rule)}catch(e){setError(e instanceof Error?e.message:'请核对配置')}};
 const changedTemplate=initial.definitionVersion!==2&&initial.type!=='allowance';
 return <Modal open onOpenChange={v=>!v&&onClose()} title={readOnly?'薪酬规则详情':initial.version===0?'新增薪酬规则':'编辑薪酬规则'} description={`${scopeLabels[rule.scope]} · ${readOnly?`v${rule.version} · ${rule.status}`:'保存为草稿后单独发布。'}`} wide>
  {!readOnly&&changedTemplate&&<p className="rule-template-note">保存后使用新模板：时薪仅保留所选计算类型。原加成触发条件不再使用，请核对配置。保存草稿不改变已发布版本，重新发布后供 HR 核算使用。</p>}
  <CompensationRuleForm rule={rule} rooms={rooms} rules={rules} onChange={next=>{setRule(next);setError('')}} readOnly={readOnly}/>{error&&<p className="rule-error" role="alert">{error}</p>}
  <div className="dialog-foot"><Button onClick={onClose}>{readOnly?'关闭':'取消'}</Button>{!readOnly&&<Button variant="primary" onClick={save}>保存草稿</Button>}</div>
 </Modal>;
}
