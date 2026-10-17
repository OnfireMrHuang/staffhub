import { useState } from 'react';
import { Plus, Radio, Send, Trash2 } from 'lucide-react';
import { useHub } from '../store';
import { Badge, Button, Empty, Modal, Panel } from '../components';
import { listRoomRuleSets, roomRuleSetId, type RoomRuleSet } from '../room-rule-sets';
import { calculationLabels, compensationExpression } from './compensation-definition';
import RoomRuleSetEditor from './RoomRuleSetEditor';

export default function RoomRuleSets() {
 const s=useHub();
 const [editor,setEditor]=useState<{set:RoomRuleSet;readOnly:boolean}|null>(null);
 const [publishing,setPublishing]=useState<RoomRuleSet|null>(null),[publishError,setPublishError]=useState('');
 const [deleting,setDeleting]=useState<RoomRuleSet|null>(null),[deleteError,setDeleteError]=useState('');
 const sets=listRoomRuleSets(s.compensationRules);
 const title=(set:RoomRuleSet)=>`${set.roomIds.map(id=>s.rooms.find(room=>room.id===id)?.name||id).join('、')||'直播间'}规则集`;
 const version=(set:RoomRuleSet)=>Math.max(...set.rules.map(rule=>rule.version),0);
 const save=(set:RoomRuleSet)=>{s.saveRoomRuleSet(set);s.notify('直播间规则集草稿已保存');setEditor(null)};
 const publish=()=>{if(!publishing)return;try{s.publishRoomRuleSet(publishing.id);s.notify(`已发布 ${publishing.rules.length} 条规则，由 HR 核算时使用`);setPublishing(null)}catch(e){setPublishError(e instanceof Error?e.message:'请核对发布范围')}};
 const remove=()=>{if(!deleting)return;try{s.deleteRoomRuleSet(deleting.id);s.notify('规则集已删除，月度任务仍然保留');setDeleting(null)}catch(e){setDeleteError(e instanceof Error?e.message:'删除未完成，请核对核算任务')}};
 const pendingDeleteCount=s.compensationTasks.filter(task=>task.status==='待核算'&&task.rule.scope==='rooms'&&roomRuleSetId(task.rule)===deleting?.id).length;
 return <section className="compensation-category" aria-label="直播间规则">
  <div className="compensation-category-actions"><Button variant="primary" onClick={()=>setEditor({set:{id:`room-set-${crypto.randomUUID()}`,roomIds:[],rules:[]},readOnly:false})}><Plus size={16}/>新增直播间规则集</Button></div>
  {sets.length?<div className="department-rule-grid">{sets.map(set=><Panel key={set.id} className="department-rule-card compensation-rule-card">
   <div className="department-rule-card-head"><span className="flow-icon"><Radio size={21}/></span><div><h2>{title(set)}</h2><small>{set.rules.length} 类规则 · v{version(set)}</small></div><Badge tone={set.rules.every(rule=>rule.status==='已发布')?'green':'amber'}>{set.rules.every(rule=>rule.status==='已发布')?'已发布':'草稿'}</Badge></div>
   <div className="department-card-projects">{set.roomIds.map(id=><Badge tone="gray" key={id}>{s.rooms.find(room=>room.id===id)?.name||id}</Badge>)}</div>
   <div className="compensation-history-list">{set.rules.map(rule=><div key={rule.id} className="compensation-history-item"><Badge tone="gray">{calculationLabels[rule.type]}</Badge><div><strong>{rule.name}</strong><small>{compensationExpression(rule)}</small></div></div>)}</div>
   <div className="department-card-actions"><Button onClick={()=>setEditor({set,readOnly:true})}>查看详情</Button><Button onClick={()=>setEditor({set,readOnly:false})}>编辑规则集</Button><Button onClick={()=>{setDeleting(set);setDeleteError('')}}><Trash2 size={14}/>删除</Button><span className="spacer"/><Button variant="primary" onClick={()=>{setPublishing(set);setPublishError('')}}><Send size={14}/>发布</Button></div>
  </Panel>)}</div>:<Panel><Empty title="尚无直播间规则集" description=""/></Panel>}
  {editor&&<RoomRuleSetEditor key={`${editor.set.id}-${editor.readOnly}`} initial={editor.set} readOnly={editor.readOnly} rooms={s.rooms} rules={s.compensationRules} onSave={save} onClose={()=>setEditor(null)}/>}
  <Modal open={!!deleting} onOpenChange={value=>!value&&setDeleting(null)} title="删除直播间规则集" description="删除整个规则集并释放直播间绑定。">
   <div className="department-publish-summary"><div><span>规则集</span><strong>{deleting&&title(deleting)}</strong></div><div><span>包含规则</span><strong>{deleting?.rules.length} 条</strong></div><div><span>历史待撤回输入</span><strong>{pendingDeleteCount} 条</strong></div></div>
   <p className="caption">历史工资、已核算任务和归档快照保留。</p>{deleteError&&<p className="rule-error" role="alert">{deleteError}</p>}<div className="dialog-foot"><Button onClick={()=>setDeleting(null)}>取消</Button><Button variant="primary" onClick={remove}>确认删除规则集</Button></div>
  </Modal>
  <Modal open={!!publishing} onOpenChange={value=>!value&&setPublishing(null)} title="发布直播间规则集" description="整组发布为可用版本，由 HR 执行月度核算时读取。">
   <div className="department-publish-summary"><div><span>规则集</span><strong>{publishing&&title(publishing)} · v{publishing&&version(publishing)}</strong></div><div><span>规则类型</span><strong>{publishing?.rules.map(rule=>calculationLabels[rule.type]).join('、')}</strong></div><div><span>适用直播间</span><strong>{publishing?.roomIds.map(id=>s.rooms.find(room=>room.id===id)?.name||id).join('、')}</strong></div></div>
   {publishError&&<p className="rule-error" role="alert">{publishError}</p>}
   <div className="dialog-foot"><Button onClick={()=>setPublishing(null)}>取消</Button><Button variant="primary" onClick={publish}>确认发布规则集</Button></div>
  </Modal>
 </section>;
}
