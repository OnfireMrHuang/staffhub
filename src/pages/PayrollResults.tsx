import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Check, Pencil, Plus } from 'lucide-react';
import { useHub, type Batch } from '../store';
import { canPayroll } from '../payroll-permissions';
import { allPayrollDetailColumns, editablePayrollDetailColumns, payrollDetailKey, payrollDetailValues, buildReviewedPayrollWorkbook, type PayrollCellValue, type PayrollCustomColumn } from '../payroll-review';
import { payrollSettlementLayout } from '../payroll-settlement-sheet';
import { Badge, Button, Empty, exportSheet, ExportButton, Modal, number, Panel, Person, SearchBox, TabBar, yuan } from '../components';
import type { PayrollRowCalculation } from '../compensation-rules';
import '../payroll-settlement.css';

export default function PayrollResults({ batch, archived, initialTab = 'detail' }: { batch: Batch; archived: boolean; initialTab?: 'detail' | 'summary' }) {
 const state = useHub(), [tab, setTab] = useState(initialTab), [search, setSearch] = useState('');
 const [editing, setEditing] = useState<{ row: PayrollRowCalculation; version: number } | null>(null);
 const [adding, setAdding] = useState<{ version: number } | null>(null), [error, setError] = useState('');
 const columns = batch.compensationResult ? allPayrollDetailColumns(batch) : [], layout = batch.compensationResult ? payrollSettlementLayout(batch.compensationResult) : null;
 const editable = !archived && !!batch.compensationResult?.rows.length && canPayroll(state, '薪酬结果编辑');
 const dirty = !!batch.review?.dirty, query = search.trim().toLocaleLowerCase();
 const rows = (batch.compensationResult?.rows ?? []).filter(row => `${row.employeeId} ${row.employeeName} ${row.roomName}`.toLocaleLowerCase().includes(query));
 const salaries = batch.salaries.filter(row => `${row.employeeId} ${row.employeeName}`.toLocaleLowerCase().includes(query));
 const customCount = columns.filter(column => column.custom).length;
 const apply = () => { try { state.applyPayrollEdits(batch.month, batch.review?.version ?? 0); setError(''); state.notify('已应用明细修改，员工月薪汇总已更新。'); } catch (cause) { setError(cause instanceof Error ? cause.message : '应用失败'); } };
 return <Panel className="payroll-results">
  <TabBar value={tab} onChange={value => setTab(value as 'detail' | 'summary')} items={[{ id: 'detail', label: '月度核算明细' }, { id: 'summary', label: '员工月薪汇总' }]} />
  <div className="toolbar"><SearchBox value={search} onChange={setSearch} placeholder={tab === 'detail' ? '搜索员工 / 直播间' : '搜索员工姓名 / ID'} /><span className="spacer" />
   {tab === 'detail' && editable && <Button onClick={() => setAdding({ version: batch.review?.version ?? 0 })}><Plus size={15} />追加表头</Button>}
   {tab === 'detail' && editable && <Button variant="primary" disabled={!dirty} onClick={apply}><Check size={15} />应用修改</Button>}
   <ExportButton onClick={() => batch.compensationResult ? XLSX.writeFile(buildReviewedPayrollWorkbook(batch), `月度薪酬核算-${batch.month}.xlsx`) : exportSheet(`员工月薪汇总-${batch.month}`, batch.salaries.map(salary => ({'员工ID':salary.employeeId,'员工名称':salary.employeeName,'部门':salary.departmentName,'月份':batch.month,'月薪合计':salary.total})), '员工月薪汇总')} />
  </div>
  {dirty && <div className="payroll-review-notice" role="status"><span>明细有未应用的修改，员工月薪汇总仍为上次应用结果。{tab === 'summary' ? '请返回月度核算明细执行应用。' : '核对后点击“应用修改”更新汇总。'}</span><Badge tone="amber">待应用</Badge></div>}
  {error && <p className="rule-error" role="alert">{error}</p>}
  {tab === 'detail' ? batch.compensationResult ? <>
   <div className="table-scroll settlement-scroll" role="region" aria-label="月度核算明细，可横向滚动" tabIndex={0}><table className="settlement-table" aria-label="月度核算明细表"><thead>
    <tr>{layout?.groups.map(group => <th key={group.key} scope="colgroup" colSpan={group.count} className={`settlement-${group.key}`}><span className="settlement-group-label">{group.label}</span></th>)}{customCount > 0 && <th colSpan={customCount} scope="colgroup" className="settlement-custom">补充信息</th>}{editable && <th rowSpan={2} className="payroll-row-action">操作</th>}</tr>
    <tr>{columns.map(column => <th key={column.key} scope="col" data-column={column.key} className={`settlement-${column.group}`}>{column.label}</th>)}</tr>
   </thead><tbody>{rows.map(row => { const values = payrollDetailValues(batch, row); return <tr key={payrollDetailKey(row)}>{columns.map(column => { const value = values[column.key]; return <td key={column.key} data-column={column.key} className={`settlement-${column.group}${column.numeric ? ' numeric align-right' : ''}${column.key === 'result.total' ? ' strong' : ''}`}>{typeof value === 'number' ? column.key === 'year' ? value : number(value, column.type === 'money' ? 2 : column.key === 'roi' ? 4 : column.key.endsWith('Rank') || column.key.endsWith('Sessions') ? 0 : 2) : value ?? '—'}</td>; })}{editable && <td className="payroll-row-action"><button className="text-button" onClick={() => setEditing({ row, version: batch.review?.version ?? 0 })} aria-label={`编辑 ${row.employeeName} ${row.roomName}`}><Pencil size={14} />编辑</button></td>}</tr>; })}</tbody></table></div>
   {!rows.length && <p className="settlement-empty">当前条件下暂无核算明细。</p>}
   <div className="table-foot"><span>共 {rows.length} 行 · 员工 × 直播间 × 月份</span><span>{columns.length} 列{batch.review?.appliedAt ? ` · 最近应用 ${batch.review.appliedAt}` : ''}</span></div>
  </> : <Empty title="历史结果仅提供员工汇总" description="该历史批次没有逐直播间的月度核算明细。" /> : <>
   <div className="table-scroll"><table aria-label="员工月薪汇总表"><thead><tr><th>员工</th><th>部门</th><th>直播间</th><th className="align-right">月薪合计</th></tr></thead><tbody>{salaries.map(salary => <tr key={salary.employeeId}><td><Person name={salary.employeeName} id={salary.employeeId} /></td><td>{salary.departmentName}</td><td>{batch.compensationResult ? new Set(batch.compensationResult.rows.filter(row => row.employeeId === salary.employeeId).map(row => row.roomId)).size : salary.details.length}</td><td className="numeric align-right strong green-text">{yuan(salary.total)}</td></tr>)}</tbody></table></div>
   {!salaries.length && <p className="settlement-empty">当前条件下暂无员工月薪汇总。</p>}
   <div className="table-foot"><span>共 {salaries.length} 位员工</span><strong>合计 {yuan(salaries.reduce((sum, salary) => sum + salary.total, 0))}</strong></div>
  </>}
  {editing && <PayrollRowEditor batch={batch} row={editing.row} expectedVersion={editing.version} onClose={() => setEditing(null)} />}
  {adding && <PayrollColumnEditor batch={batch} expectedVersion={adding.version} onClose={() => setAdding(null)} />}
 </Panel>;
}

function PayrollRowEditor({ batch, row, expectedVersion, onClose }: { batch: Batch; row: PayrollRowCalculation; expectedVersion: number; onClose: () => void }) {
 const state = useHub(), columns = editablePayrollDetailColumns(batch), [original] = useState(() => payrollDetailValues(batch, row));
 const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(columns.map(column => [column.key, typeof original[column.key] === 'number' || column.type === 'text' ? String(original[column.key] ?? '') : ''])));
 const [reason, setReason] = useState(''), [error, setError] = useState('');
 const groups = [...new Set(columns.map(column => column.group))];
 const groupLabels: Record<string, string> = { statistics: '直播数据统计', global: '全局核算指标', rooms: '直播间核算指标', employees: '历史员工核算指标', result: '结果指标', custom: '补充信息' };
 const save = () => { try {
  const patch: Record<string, PayrollCellValue> = {};
  for (const column of columns) {
   const text = values[column.key];
   const current = typeof original[column.key] === 'number' || column.type === 'text' ? String(original[column.key] ?? '') : '';
   if (text === current) continue;
   if (column.type !== 'text' && !column.custom && text.trim() === '') throw new Error(`${column.label}不能为空`);
   patch[column.key] = column.type === 'text' ? text : text.trim() === '' ? null : Number(text);
  }
  state.savePayrollDetail(batch.month, payrollDetailKey(row), patch, reason, expectedVersion); onClose();
 } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); } };
 return <Modal open onOpenChange={open => !open && onClose()} title={`编辑核算明细 · ${row.employeeName}`} description={`${row.roomName} · ${row.month}。直接修改结果值，不自动重算其他字段；保存后需执行应用。`} wide>
  <form onSubmit={event => { event.preventDefault(); save(); }}><div className="payroll-result-edit-fields">{groups.map(group => <fieldset key={group}><legend>{groupLabels[group] ?? group}</legend><div className="form-grid">{columns.filter(column => column.group === group).map(column => <label key={column.key}>{column.label}<input aria-label={`${groupLabels[group] ?? group} · ${column.label}`} type={column.type === 'text' ? 'text' : 'number'} step="any" value={values[column.key]} onChange={event => setValues({ ...values, [column.key]: event.target.value })} /></label>)}</div></fieldset>)}</div>
   <label className="payroll-edit-reason">修改原因<textarea aria-label="修改原因" value={reason} onChange={event => setReason(event.target.value)} placeholder="填写本次修订的原因" required /></label>{error && <p className="rule-error" role="alert">{error}</p>}
   <div className="dialog-foot"><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary">保存明细</Button></div>
  </form>
 </Modal>;
}
function PayrollColumnEditor({ batch, expectedVersion, onClose }: { batch: Batch; expectedVersion: number; onClose: () => void }) {
 const state = useHub(), [label, setLabel] = useState(''), [type, setType] = useState<PayrollCustomColumn['type']>('text'), [error, setError] = useState('');
 const save = () => { try { state.addPayrollColumn(batch.month, { id: `custom_${crypto.randomUUID().replaceAll('-', '')}`, label: label.trim(), type }, expectedVersion); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : '追加失败'); } };
 return <Modal open onOpenChange={open => !open && onClose()} title="追加表头" description="追加字段仅用于本月核算明细的复核与补充信息。"><form onSubmit={event => { event.preventDefault(); save(); }}><div className="form-grid"><label>表头名称<input aria-label="表头名称" value={label} onChange={event => setLabel(event.target.value)} required /></label><label>字段类型<select aria-label="字段类型" value={type} onChange={event => setType(event.target.value as PayrollCustomColumn['type'])}><option value="text">文本</option><option value="number">数字</option><option value="money">金额</option></select></label></div>{error && <p className="rule-error" role="alert">{error}</p>}<div className="dialog-foot"><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary">确认追加</Button></div></form></Modal>;
}
