import { useState } from 'react';
import { Coins, Globe2, Plus, Radio, Send, Trash2 } from 'lucide-react';
import { useHub } from '../store';
import { Badge, Button, Empty, Modal, Panel, TabBar } from '../components';
import { type CompensationRule, type Scope } from '../compensation-rules';
import CompensationRuleEditor, { calculationLabels, compensationExpression, createCompensationRule, scopeLabels } from './CompensationRuleEditor';
import RoomRuleSets from './RoomRuleSets';
import '../salary-rules.css';
import '../compensation-rules.css';

export default function Rules() {
 const s=useHub(),[scope,setScope]=useState<Scope>('global'),[editor,setEditor]=useState<{rule:CompensationRule;readOnly:boolean}|null>(null),[publishing,setPublishing]=useState<CompensationRule|null>(null),[publishError,setPublishError]=useState('');
 const [deleting,setDeleting]=useState<CompensationRule|null>(null),[deleteError,setDeleteError]=useState('');
 const rules=s.compensationRules.filter(r=>!r.deletedAt&&r.scope===scope);
 const addRule=()=>setEditor({readOnly:false,rule:createCompensationRule(scope)});
 const save=(rule:CompensationRule)=>{s.saveCompensationRule(rule);s.notify('规则草稿已保存');setEditor(null)};
 const publish=()=>{if(!publishing)return;try{s.publishCompensationRule(publishing.id);s.notify('规则已发布，将在 HR 核算时使用');setPublishing(null)}catch(e){setPublishError(e instanceof Error?e.message:'请核对发布范围')}};
 const remove=()=>{if(!deleting)return;try{s.deleteCompensationRule(deleting.id);s.notify('规则已删除，月度任务仍然保留');setDeleting(null)}catch(e){setDeleteError(e instanceof Error?e.message:'删除未完成，请核对规则与核算任务')}};
 const pendingDeleteCount=s.compensationTasks.filter(task=>task.ruleId===deleting?.id&&task.status==='待核算').length;
 const tabs=[{id:'global',label:'全局规则',icon:<Globe2 size={15}/>},{id:'rooms',label:'直播间规则',icon:<Radio size={15}/>}];
 return <><TabBar value={scope} onChange={value=>setScope(value as Scope)} items={tabs}/>
 {scope==='rooms'?<RoomRuleSets/>:<section className="compensation-category" aria-label={scopeLabels[scope]}>
 <div className="compensation-category-actions"><Button variant="primary" onClick={addRule}><Plus size={16}/>新增薪酬规则</Button></div>{rules.length?<div className="department-rule-grid">{rules.map(rule=><Panel key={rule.id} className="department-rule-card compensation-rule-card"><div className="department-rule-card-head"><span className="flow-icon"><Coins size={21}/></span><div><h2>{rule.name}</h2><small>{calculationLabels[rule.type]} · v{rule.version}</small></div><Badge tone={rule.status==='已发布'?'green':'amber'}>{rule.status}</Badge></div><div className="department-card-formula"><small>计算配置</small><p>{compensationExpression(rule)}</p></div><div className="department-card-projects">{rule.scope==='rooms'?rule.roomIds.map(id=><Badge tone="gray" key={id}>{s.rooms.find(r=>r.id===id)?.name||id}</Badge>):<Badge tone="gray">全部有效员工直播月度数据</Badge>}</div><div className="department-card-actions"><Button onClick={()=>setEditor({rule,readOnly:true})}>查看详情</Button><Button onClick={()=>setEditor({rule,readOnly:false})}>编辑规则</Button><Button onClick={()=>{setDeleting(rule);setDeleteError('')}}><Trash2 size={14}/>删除</Button><span className="spacer"/><Button variant="primary" onClick={()=>{setPublishing(rule);setPublishError('')}}><Send size={14}/>发布</Button></div></Panel>)}</div>:<Panel><Empty title={`尚无${scopeLabels[scope]}`} description=""/></Panel>}
 </section>}
 {editor&&<CompensationRuleEditor key={`${editor.rule.id}-${editor.readOnly}`} initial={editor.rule} readOnly={editor.readOnly} rooms={s.rooms} rules={s.compensationRules} onSave={save} onClose={()=>setEditor(null)}/>}
 <Modal open={!!deleting} onOpenChange={v=>!v&&setDeleting(null)} title="删除薪酬规则" description="删除后停止使用该规则，月度任务继续保留，已归档结果不变。"><div className="department-publish-summary"><div><span>规则</span><strong>{deleting?.name} · v{deleting?.version}</strong></div><div><span>历史待撤回输入</span><strong>{pendingDeleteCount} 条</strong></div></div><p className="caption">确认删除「{deleting?.name}」后，该规则将不再显示在规则列表中，不能继续编辑或发布。历史工资、已核算任务和归档快照保持不变。</p>{deleteError&&<p className="rule-error" role="alert">{deleteError}</p>}<div className="dialog-foot"><Button onClick={()=>setDeleting(null)}>取消</Button><Button variant="primary" onClick={remove}>确认删除</Button></div></Modal>
 <Modal open={!!publishing} onOpenChange={v=>!v&&setPublishing(null)} title="发布薪酬规则" description="发布后成为可用规则版本，由 HR 执行月度核算时读取。"><div className="department-publish-summary"><div><span>规则</span><strong>{publishing?.name} · v{publishing?.version}</strong></div><div><span>分类 / 类型</span><strong>{publishing&&`${scopeLabels[publishing.scope]} / ${calculationLabels[publishing.type]}`}</strong></div><div><span>计算配置</span><strong>{publishing&&compensationExpression(publishing)}</strong></div></div>{publishError&&<p className="rule-error" role="alert">{publishError}</p>}<div className="dialog-foot"><Button onClick={()=>setPublishing(null)}>取消</Button><Button variant="primary" onClick={publish}>确认发布</Button></div></Modal>
 </>;
}
