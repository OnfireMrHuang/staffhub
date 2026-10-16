import { useState } from 'react';
import { ArrowLeft, Calculator, FileCheck2, RefreshCw, Send } from 'lucide-react';
import { payrollBatchInputIssue, useHub } from '../store';
import { canPayroll } from '../payroll-permissions';
import { payrollCalculationConfirmation, type MonthlyPayrollTask } from '../payroll-task-view';
import { Badge, Button, Empty, Modal, Panel, yuan } from '../components';
import { calculationLabels, compensationExpression, scopeLabels } from './CompensationRuleEditor';
import PayrollResults from './PayrollResults';

export default function PayrollTaskDetail({ task, onBack }: { task: MonthlyPayrollTask; onBack: () => void }) {
 const state = useHub(), { month, batch, status } = task;
 const [confirm, setConfirm] = useState<ReturnType<typeof payrollCalculationConfirmation> | {type:'archive';version:number} | {type:'publish'} | null>(null);
 const [withdraw, setWithdraw] = useState<{ id: string; modern: boolean; group: boolean } | null>(null);
 const [error, setError] = useState('');
 const active = task.tasks.filter(item => item.status !== '已撤回');
 const archived = status === '已归档';
 const inputIssue = batch && !archived ? payrollBatchInputIssue(state, batch) : '';
 const ready = state.dataset.month === month && state.month === month && state.dataset.published && state.dataset.revision === state.revision;
 const mixed = active.some(item => 'scope' in item) && active.some(item => !('scope' in item));
 const canCalculate = canPayroll(state, '薪酬核算'), canArchive = canPayroll(state, '薪酬归档'), canPublish = canPayroll(state, '工资发布');
 const run = () => {
  try {
   if (confirm?.type === 'calculate') { if (state.month !== month) state.setMonth(month); useHub.getState().runPayroll(confirm.version); }
   else if (confirm?.type === 'archive') state.archivePayroll(month, confirm.version);
   else if (confirm?.type === 'publish') { if (state.month !== month) state.setMonth(month); useHub.getState().publishBatch(); }
   setConfirm(null); setError('');
  } catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成'); setConfirm(null); }
 };
 const rooms = batch?.snapshot.rooms ?? state.rooms;
 return <div className="payroll-task-detail">
  <div className="payroll-detail-heading"><Button onClick={onBack}><ArrowLeft size={15} />返回任务列表</Button><span className="spacer" />
   {!archived && canCalculate && <Button variant="primary" disabled={!active.length || !ready || mixed} onClick={() => setConfirm(payrollCalculationConfirmation(batch))}><Calculator size={15} />{batch ? '重新核算' : '核算'}</Button>}
   {batch && !archived && canArchive && <Button variant="primary" disabled={!!batch.review?.dirty || !!inputIssue} onClick={() => setConfirm({ type: 'archive', version: batch.review?.version ?? 0 })}><FileCheck2 size={15} />确认无误并归档</Button>}
   {archived && batch?.status !== '已发布' && canPublish && <Button onClick={() => setConfirm({ type: 'publish' })}><Send size={15} />发布工资条</Button>}
   {archived && batch?.status === '已发布' && <Badge tone="green">工资条已发布</Badge>}
  </div>
  <Panel className="payroll-task-basics"><div className="payroll-detail-title"><h1>{month} 月度薪酬核算</h1><Badge tone={archived ? 'green' : status === '已撤回' ? 'gray' : 'amber'}>{status}</Badge></div>
   <dl className="payroll-basic-grid"><div><dt>核算月份</dt><dd>{month}</dd></div><div><dt>发布规则</dt><dd>{active.length} 条</dd></div><div><dt>参与员工</dt><dd>{task.employees} 人</dd></div><div><dt>数据集版本</dt><dd>{batch ? `v${batch.datasetVersion}` : [...new Set(active.map(item => `v${item.datasetVersion}`))].join(' / ') || '—'}</dd></div><div><dt>核算完成时间</dt><dd>{batch?.created || '—'}</dd></div><div><dt>归档时间</dt><dd>{batch?.archivedAt || (archived ? '历史归档' : '未归档')}</dd></div></dl>
   <details className="payroll-rule-inputs"><summary>规则依据 · {active.length} 条</summary><div className="table-scroll"><table aria-label="核算规则依据"><thead><tr><th>规则</th><th>类型</th><th>适用范围</th><th>配置摘要</th><th>状态</th>{!archived && canCalculate && <th />}</tr></thead><tbody>{task.tasks.map(item => {
    const modern = 'scope' in item;
    return <tr key={item.id}><td><strong>{item.ruleName}</strong><small>v{item.ruleVersion}</small></td><td>{modern ? calculationLabels[item.type] : '历史规则'}</td><td>{modern && item.scope !== 'rooms' ? scopeLabels[item.scope] : item.rule.roomIds.map(id => rooms.find(room => room.id === id)?.name || id).join('、')}</td><td>{modern ? compensationExpression(item.rule) : '按发布时冻结配置计算'}</td><td><Badge tone={item.status === '已撤回' ? 'gray' : item.status === '已核算' ? 'green' : 'amber'}>{item.status}</Badge></td>{!archived && canCalculate && <td>{item.status !== '已撤回' && !archived && <Button onClick={() => setWithdraw({ id: item.id, modern, group: modern && !!item.roomRuleSet })}>{modern && item.roomRuleSet ? '撤回规则集' : '撤回任务'}</Button>}</td>}</tr>;
   })}</tbody></table></div></details>
  </Panel>
  {error && <p className="rule-error" role="alert">{error}</p>}
  {!!inputIssue && <p className="rule-error" role="alert">{inputIssue}。原核算结果暂时保留，重新核算后再复核归档。</p>}
  {!archived && mixed && <p className="rule-error" role="alert">本月同时存在新版与旧版任务，请先在规则依据中撤回旧版任务。</p>}
  {!archived && active.length > 0 && !ready && <div className="payroll-review-notice"><span>请先刷新 {month} 的员工月度汇总，再进行核算。</span>{canCalculate && <Button onClick={() => { state.setMonth(month); state.navigate('operations', 'datasets'); }}><RefreshCw size={15} />去刷新月度汇总</Button>}</div>}
  {batch ? <PayrollResults batch={batch} archived={archived} /> : <Panel><Empty title={status === '已撤回' ? '本月任务已撤回' : '尚未核算'} description={status === '已撤回' ? '重新发布薪酬规则后，可在此核算。' : '核算结果将在确认核算后生成。'} /></Panel>}
  <Modal open={!!confirm} onOpenChange={open => !open && setConfirm(null)} title={confirm?.type === 'publish' ? '发布员工工资条' : confirm?.type === 'archive' ? '确认归档本月薪酬' : '确认执行月度核算'} description={confirm?.type === 'publish' ? '发布后员工可在本人资料中查看已归档的工资条。此操作仅改变本地演示状态。' : confirm?.type === 'archive' ? '请确认两张结果表已复核无误。归档后本月来源数据和核算结果将锁定。' : `${batch ? '重新核算将替换现有结果，并清除已编辑的明细、自定义表头和应用记录。' : ''}将使用本月全部已发布规则和已确认的员工月度汇总生成结果，完成后由 HR 复核并手动归档。`}>
   <div className="confirmation-summary"><span>核算月份<strong>{month}</strong></span><span>员工人数<strong>{task.employees} 人</strong></span><span>{confirm?.type !== 'calculate' ? '月薪汇总' : '发布规则'}<strong>{confirm?.type !== 'calculate' ? yuan(batch?.salaries.reduce((sum, salary) => sum + salary.total, 0) ?? 0) : `${active.length} 条`}</strong></span></div>
   <div className="dialog-foot"><Button onClick={() => setConfirm(null)}>取消</Button><Button variant="primary" onClick={run}>{confirm?.type === 'publish' ? '确认发布' : confirm?.type === 'archive' ? '确认归档' : '确认核算'}</Button></div>
  </Modal>
  <Modal open={!!withdraw} onOpenChange={open => !open && setWithdraw(null)} title={withdraw?.group ? '撤回规则集任务' : '撤回待核算任务'} description={withdraw?.group ? '将撤回本月同一规则集的全部任务，保留发布记录。' : '撤回后该规则不参与本月核算，发布记录仍然保留。'}><div className="dialog-foot"><Button onClick={() => setWithdraw(null)}>取消</Button><Button variant="primary" onClick={() => { try { if (withdraw?.modern) state.withdrawCompensationTask(withdraw.id); else if (withdraw) state.withdrawPayrollTask(withdraw.id); setWithdraw(null); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '撤回失败'); setWithdraw(null); } }}>确认撤回</Button></div></Modal>
 </div>;
}
