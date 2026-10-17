import { useState } from 'react';
import { Calculator, ChevronRight, ShieldCheck } from 'lucide-react';
import { useHub } from '../store';
import type { Salary } from '../domain';
import { metricNames } from '../domain';
import { monthlyMetricOptions } from '../payroll-rules';
import { guaranteeRateFieldOptions, premiumFieldOptions, type CompensationResult, type CompensationRule, type HourlyItemCalculation } from '../compensation-rules';
import { compensationMetricLabel } from './CompensationRuleEditor';
import { Badge, Empty, Modal, number, Panel, Person, SearchBox, yuan } from '../components';
import { monthlyPayrollTasks, type MonthlyTaskStatus } from '../payroll-task-view';
import PayrollTaskDetail from './PayrollTaskDetail';
import { payrollSettlementLayout } from '../payroll-settlement-sheet';
import { conditionEvidenceText, conditionEvidenceValueLabel } from '../condition-labels';
export { conditionEvidenceText, conditionEvidenceValueLabel } from '../condition-labels';
import '../compensation-rules.css';
import '../payroll-tasks.css';

export default function Payroll() {
 const state = useHub();
 const [search, setSearch] = useState(''), [month, setMonth] = useState(''), [status, setStatus] = useState('');
 const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
 const tasks = monthlyPayrollTasks(state);
 const openTask = (taskMonth: string) => { state.setMonth(taskMonth); setSelectedMonth(taskMonth); };
 const selected = tasks.find(task => task.month === selectedMonth);
 if (selected) return <PayrollTaskDetail task={selected} onBack={() => setSelectedMonth(null)} />;
 const query = search.trim().toLocaleLowerCase();
 const rows = tasks.filter(task => (!month || task.month === month) && (!status || task.status === status)
  && `${task.month} ${[...task.tasks.map(rule=>rule.ruleName),...(task.rules??[]).map(rule=>rule.name)].join(' ')}`.toLocaleLowerCase().includes(query));
 return <Panel className="payroll-task-list">
  <div className="toolbar payroll-task-filters" aria-label="核算任务筛选栏">
   <SearchBox value={search} onChange={setSearch} placeholder="搜索核算月份 / 规则名称" />
   <select aria-label="筛选核算月份" value={month} onChange={event => setMonth(event.target.value)}><option value="">全部月份</option>{tasks.map(task => <option key={task.month} value={task.month}>{task.month}</option>)}</select>
   <select aria-label="筛选任务状态" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option>{(['待核算','待复核','待应用','待重新核算','已归档','已撤回'] as MonthlyTaskStatus[]).map(value => <option key={value}>{value}</option>)}</select>
   <span className="spacer" /><span className="muted">{rows.length} 项任务</span>
  </div>
  {rows.length ? <div className="table-scroll"><table aria-label="核算任务列表"><thead><tr><th>核算任务</th><th>发布规则</th><th>员工人数</th><th>状态</th><th>更新时间</th><th /></tr></thead><tbody>{rows.map(task => <tr key={task.month} className="payroll-task-row" onClick={() => openTask(task.month)}>
   <td><button className="payroll-task-open" onClick={event => { event.stopPropagation(); openTask(task.month); }}>{task.month} 月度薪酬核算</button>{task.batch?.ruleSource==='demo' && <Badge tone="amber">模拟数据</Badge>}</td>
   <td>{task.rules?.length ?? task.tasks.filter(rule => rule.status !== '已撤回').length} 条</td><td>{task.employees} 人</td><td><Badge tone={task.status === '已归档' ? 'green' : task.status === '已撤回' ? 'gray' : 'amber'}>{task.status}</Badge></td><td>{task.updatedAt || '—'}</td><td><ChevronRight size={16} aria-hidden="true" /></td>
  </tr>)}</tbody></table></div> : <Empty title="暂无核算任务" description={tasks.length ? '请调整筛选条件。' : '系统每月 1 日生成上个月的待核算任务，由 HR 手动核算与确认。'} />}
 </Panel>;
}

export function SalaryModal({salary,onClose,month,version}:{salary:Salary|null;onClose:()=>void;month:string;version?:number}){
 const compensation=useHub(s=>s.batches[month]?.compensationResult??(s.batch?.month===month?s.batch.compensationResult:undefined));
 const frozenTasks=useHub(s=>s.batches[month]?.snapshot.compensationTasks??(s.batch?.month===month?s.batch.snapshot.compensationTasks:undefined));
 const rooms=useHub(s=>s.batches[month]?.snapshot.rooms??s.rooms);
 const products=useHub(s=>s.batches[month]?.snapshot.products??s.products);
 if(compensation)return <CompensationSalaryModal salary={salary} onClose={onClose} month={month} version={version} result={compensation} rules={frozenTasks?.filter(task=>task.month===month&&task.status==='已核算').map(task=>task.rule)}/>;
 return <Modal open={!!salary} onOpenChange={v=>!v&&onClose()} title={`${salary?.employeeName||''} · ${month} 薪资明细`} description={`数据集 v${version||1} · 规则与工资使用核算时快照。`} wide>{salary&&<><div className="salary-detail-head"><Person name={salary.employeeName} id={salary.employeeId}/><Badge tone="gray">{salary.departmentName}</Badge><div className="spacer"/><span>月度应发<strong>{yuan(salary.total)}</strong></span></div><div className="formula-box"><Calculator size={19}/><div><strong>月度薪资 = ∑（各统计指标时薪 × 各自绑定时长）</strong><p>绑定相同时长的项，等价于先相加时薪再乘该时长。</p></div></div><h3 className="detail-section-title">规则与直播间集合计算依据</h3>{salary.details.map(d=><div className="salary-group" key={d.groupId}><div className="inline"><strong>{d.ruleName}</strong><Badge tone="gray">v{d.ruleVersion}</Badge><span className="spacer"/><strong className="green-text">{yuan(d.commission)}</strong></div><p className="salary-projects">产品：{(d.productIds??[]).map(id=>products.find(p=>p.id===id)?.name||id).join("、")} · 参与直播间：{(d.roomIds??d.projectIds).map(id=>`${rooms.find(r=>r.id===id)?.name||id}`).join('、')}</p><div className="group-metrics"><span>总时长<strong>{number(d.hours,2)} h</strong></span><span>合计消耗<strong>{yuan(d.spend)}</strong></span><span>合计保费<strong>{yuan(d.premium)}</strong></span><span>重算 ROI<strong>{number(d.roi,4)}</strong></span><span>重算时耗<strong>{number(d.hourlySpend,2)} 元/h</strong></span></div>{d.components?<div className="table-scroll"><table><thead><tr><th>统计指标</th><th>匹配依据</th><th>时薪</th><th>绑定时长</th><th>薪资金额</th></tr></thead><tbody>{d.components.map((c,i)=><tr key={`${c.metricId}-${i}`}><td>{c.fieldName}</td><td>{!['hours','nightHours','earlyHours'].includes(c.field)&&c.matchField?`${monthlyMetricOptions.find(m=>m.field===c.matchField)?.label||c.matchField} ${number(c.matchValue,4)}`:'直接指定时薪'}</td><td>{yuan(c.rate)} / h</td><td>{c.durationName} · {number(c.hours,2)} h</td><td className="numeric strong">{yuan(c.amount)}</td></tr>)}</tbody></table></div>:<div className="matching-line">{d.matches.map((m,i)=><span key={`${m.metric}-${i}`}>{i>0&&<b> + </b>}{metricNames[m.metric]} {number(m.input,4)} → <strong>{number(m.rate,2)} 元/h</strong></span>)}<span>{number(d.rate,2)} 元/h × {number(d.hours,2)} h = {yuan(d.commission)}</span></div>}</div>)}<div className="info-strip"><ShieldCheck size={18}/><p>直播间集合先汇总基础值再重算比值。不同规则和不同时长的薪资分别计算后相加；只有实际配置的指标项才计入工资。</p></div></>}</Modal>;
}

function hourlyItemFieldLabel(item:HourlyItemCalculation):string {
 return item.kind==='guarantee' ? guaranteeRateFieldOptions.find(option=>option.field===item.field)?.label ?? item.field ?? '' : compensationMetricLabel(item.field||'');
}
type SalaryRule = Pick<CompensationRule,'id'|'name'> & Partial<Pick<CompensationRule,'version'>>;
export function CompensationSalaryDetails({salary,result,rules=[]}:{salary:Salary;result:CompensationResult;rules?:SalaryRule[]}) {
 if(result.settlementVersion===2)return <LayeredCompensationSalaryDetails salary={salary} result={result} rules={rules}/>;
 const ruleName=(id:string)=>{const rule=rules.find(rule=>rule.id===id);return rule?`${rule.name}${rule.version===undefined?'':` · v${rule.version}`}`:id;};
 const rows=result.rows.filter(row=>row.employeeId===salary.employeeId);
 return <><div className="salary-detail-head"><Person name={salary.employeeName} id={salary.employeeId}/><Badge tone="gray">{salary.departmentName}</Badge><span className="spacer"/><span>月度应发<strong>{yuan(salary.total)}</strong></span></div><p className="compensation-trace-formula">月度应发 = 各直播间、各时长的 max（触发保薪最大值，加成合计）× 时长 + 补贴。条件日期参考：{result.referenceDate}。</p>{rows.map(row=><article key={`${row.month}-${row.roomId}`} className="compensation-row-trace"><div className="inline"><strong>{row.roomName}</strong><Badge tone="gray">{row.matchedRuleIds.length} 条命中规则</Badge><span className="spacer"/><strong className="green-text">{yuan(row.total)}</strong></div><p className="compensation-trace-formula">参与规则：{row.matchedRuleIds.map(ruleName).join('、')}</p><h3 className="detail-section-title">保费与 ROI 计算依据</h3><div className="group-metrics"><span>原总保费<strong>{yuan(row.premium.before)}</strong></span><span>正常保费<strong>{row.premium.regular===null?'未定义':yuan(row.premium.regular)}</strong></span><span>早班保费<strong>{row.premium.early===null?'未定义':yuan(row.premium.early)}</strong></span>{!row.premium.candidates&&<span>有效系数<strong>{number(row.premium.coefficient,4)}</strong></span>}<span>有效保费<strong>{yuan(row.premium.after)}</strong></span><span>原 ROI<strong>{row.premium.roiBefore===null?'—':number(row.premium.roiBefore,4)}</strong></span><span>有效 ROI<strong>{row.premium.roiAfter===null?'—':number(row.premium.roiAfter,4)}</strong></span><span>有效 ROI 排名<strong>{row.premium.rank??'—'}</strong></span></div>{row.premium.candidates&&<div className="table-scroll"><table><thead><tr><th>保费系数规则</th><th>系数项计算依据</th><th>公式总额</th><th>采用结果</th></tr></thead><tbody>{row.premium.candidates.map(candidate=><tr key={candidate.ruleId}><td>{ruleName(candidate.ruleId)}</td><td>{candidate.items.map(item=><div key={item.id}>{item.name}：{premiumFieldOptions.find(option=>option.field===item.field)?.label} {yuan(item.value)} × {number(item.coefficient,4)} = {yuan(item.amount)}</div>)}</td><td>{yuan(candidate.amount)}</td><td>{candidate.selected?'采用最高总额':'未采用'}</td></tr>)}</tbody></table></div>}{row.durationGroups.length>0&&<div className="table-scroll"><table><thead><tr><th>计薪时长</th><th>小时</th><th>触发保薪最大值</th><th>加成合计</th><th>最终时薪</th><th>金额</th></tr></thead><tbody>{row.durationGroups.map(group=><tr key={group.duration}><td>{compensationMetricLabel(group.duration)}</td><td>{number(group.hours,2)} h</td><td>{yuan(group.guarantee)} / h</td><td>{yuan(group.additions)} / h</td><td>{yuan(group.rate)} / h</td><td className="strong numeric">{yuan(group.amount)}</td></tr>)}</tbody></table></div>}{row.durationGroups.map(group=><details className="compensation-evidence" key={group.duration}><summary>{compensationMetricLabel(group.duration)} · 时薪项目依据</summary><div className="table-scroll"><table><thead><tr><th>项目</th><th>类型</th><th>取值</th><th>是否触发</th><th>时薪</th></tr></thead><tbody>{group.items.map((item,i)=><tr key={`${item.ruleId}-${item.itemId}-${i}`}><td>{item.name}<small>{ruleName(item.ruleId)}</small></td><td>{item.kind==='metric'?'统计指标':item.kind==='guarantee'?'条件保薪':'特殊时段加成'}</td><td>{item.field?`${hourlyItemFieldLabel(item)} ${item.value===undefined?'—':number(item.value,4)}`:'直接时薪'}</td><td>{item.matched?'命中':'未命中'}</td><td>{yuan(item.rate)} / h</td></tr>)}</tbody></table></div></details>)}{row.allowanceItems.length>0&&<><h3 className="detail-section-title">补贴 · {yuan(row.allowance)}</h3>{row.allowanceItems.map((item,index)=><p key={`${item.ruleId}-${index}`} className="compensation-trace-formula">{ruleName(item.ruleId)} · {compensationMetricLabel(item.field||'nightSessions')} {number(item.sessions,2)} {item.field==='waitingSalaryDays'?'天':'次'} × {yuan(item.rate)} / {item.field==='waitingSalaryDays'?'天':'次'} = {yuan(item.amount)}</p>)}</>}{row.conditions.length>0&&<details className="compensation-evidence"><summary>条件取值与判断依据</summary>{row.conditions.map((evidence,index)=><p key={index}><strong>{evidence.matched?'命中':'未命中'}</strong> · {conditionEvidenceText(evidence.condition)}<br/>{Object.entries(evidence.values).map(([field,value])=>`${conditionEvidenceValueLabel(field)}：${typeof value==='boolean'?(value?'是':'否'):value}`).join('；')}</p>)}</details>}</article>)}</>;
}
function LayeredCompensationSalaryDetails({salary,result,rules}:{salary:Salary;result:CompensationResult;rules:SalaryRule[]}) {
 const rows=result.rows.filter(row=>row.employeeId===salary.employeeId);
 const ruleName=(id:string)=>{const rule=rules.find(rule=>rule.id===id);return rule?`${rule.name}${rule.version===undefined?'':` · v${rule.version}`}`:id;};
 const scopeNames={global:'全局核算',rooms:'直播间核算',employees:'历史员工核算'};
 const scopeOrder=payrollSettlementLayout(result).groups.some(group=>group.key==='employees')?(['global','rooms','employees'] as const):(['global','rooms'] as const);
 const amount=(value:number|null|undefined)=>value==null?'未定义':yuan(value);
 const metric=(value:number|null|undefined,digits=4)=>value==null?'未定义':number(value,digits);
 return <>
  <div className="salary-detail-head"><Person name={salary.employeeName} id={salary.employeeId}/><Badge tone="gray">{salary.departmentName}</Badge><span className="spacer"/><span>原始核算月薪<strong>{yuan(salary.total)}</strong></span></div>
  <div className="settlement-formula"><strong>每个直播间月薪 = max（最终保底金额，累计加成金额）+ 总计补贴</strong><p>员工月薪 = 各直播间月薪之和。保底逐规则先乘时长再取最大金额；加成逐规则先乘时长再累加。条件日期参考：{result.referenceDate}。</p></div>
  {rows.map(row=><article key={`${row.month}-${row.roomId}`} className="compensation-row-trace">
   <div className="inline"><strong>{row.roomName}</strong><Badge tone="gray">{row.month}</Badge><Badge tone="gray">{row.matchedRuleIds.length} 条适用规则</Badge><span className="spacer"/><strong className="green-text">{yuan(row.total)}</strong></div>
   <p className="compensation-trace-formula">参与规则：{row.matchedRuleIds.length?row.matchedRuleIds.map(ruleName).join('、'):'本行无适用规则'}</p>
   <h3 className="detail-section-title">原始统计与系数后指标</h3>
   <div className="group-metrics">
    <span>原始总保费<strong>{amount(row.statistics?row.statistics.premium:row.premium.before)}</strong></span>
    <span>正常保费<strong>{amount(row.statistics?row.statistics.regularPremium:row.premium.regular)}</strong></span>
    <span>早班保费<strong>{amount(row.statistics?row.statistics.earlyPremium:row.premium.early)}</strong></span>
    <span>系数后总计保费<strong>{amount(row.premium.after)}</strong></span>
    <span>原始 ROI<strong>{metric(row.statistics?row.statistics.roi:row.premium.roiBefore)}</strong></span>
    <span>系数后 ROI<strong>{metric(row.premium.roiAfter)}</strong></span>
    <span>原始 ROI 排名<strong>{metric(row.statistics?.roiRank,0)}</strong></span>
    <span>系数后 ROI 排名<strong>{metric(row.premium.rank,0)}</strong></span>
   </div>
   <p className="compensation-trace-formula">系数保费仅用于后续 ROI 与排名计算，不直接计入工资。没有适用系数规则时沿用原始保费；统计列始终保留原值。</p>
   <h3 className="detail-section-title">分层核算金额</h3>
   <div className="table-scroll"><table className="settlement-scope-table" aria-label={`${row.roomName} · 分层核算金额`}><thead><tr><th>核算范围</th><th className="align-right">补贴</th><th className="align-right">保底</th><th className="align-right">加成</th><th className="align-right">系数加成后保费</th></tr></thead><tbody>
    {scopeOrder.map(scope=>{const totals=row.scopes?.[scope];return <tr key={scope} data-scope={scope} className={`settlement-scope-${scope}`}><td>{scopeNames[scope]}</td><td className="numeric align-right">{yuan(totals?.allowance??0)}</td><td className="numeric align-right">{yuan(totals?.guarantee??0)}</td><td className="numeric align-right">{yuan(totals?.additions??0)}</td><td className="numeric align-right">{yuan(totals?.premium??0)}</td></tr>})}
   </tbody></table></div>
   <h3 className="detail-section-title">逐规则金额</h3>
   {(row.ruleCalculations??[]).length?<div className="table-scroll"><table className="settlement-rule-table" aria-label={`${row.roomName} · 逐规则金额`}><thead><tr><th>规则</th><th>核算范围</th><th>项目</th><th>计算依据</th><th>条件</th><th>采用方式</th><th className="align-right">规则金额</th></tr></thead><tbody>{row.ruleCalculations!.map((calculation,index)=>{
    const items=row.durationGroups.filter(group=>!group.scope||group.scope===calculation.scope).flatMap(group=>group.items.filter(item=>item.ruleId===calculation.ruleId));
    const candidate=row.premium.candidates?.find(item=>item.ruleId===calculation.ruleId);
    const selection=calculation.type==='premium'?(candidate?.selected?'采用最高保费':'未采用'):calculation.type==='allowance'?'累计补贴':calculation.mode==='guarantee'?(calculation.amount>0&&calculation.amount===row.guarantee?'采用最高保底':'未采用'):'累计加成';
    const allowances=row.allowanceItems.filter(item=>item.ruleId===calculation.ruleId);
    const evidence=calculation.type==='hourly'?`${amount(calculation.rate)} / h × ${metric(calculation.hours,2)} h（${calculation.duration?compensationMetricLabel(calculation.duration):'未定义时长'}）`:calculation.type==='premium'?(calculation.coefficient===undefined?'各保费项乘配置系数后求和':`有效系数 ${number(calculation.coefficient,4)}`):allowances.map(item=>`${compensationMetricLabel(item.field||'nightSessions')} ${number(item.sessions,0)} ${item.field==='waitingSalaryDays'?'天':'次'} × ${yuan(item.rate)} / ${item.field==='waitingSalaryDays'?'天':'次'}`).join('；')||'补贴金额';
    return <tr key={`${calculation.ruleId}-${index}`}><td>{ruleName(calculation.ruleId)}</td><td>{scopeNames[calculation.scope]}</td><td>{calculation.type==='hourly'?(calculation.mode==='guarantee'?'保底':'加成'):calculation.type==='premium'?'系数保费':'补贴'}</td><td>{evidence}{items.map((item,itemIndex)=><small key={`${item.itemId}-${itemIndex}`}>{item.name} · {item.field?`${hourlyItemFieldLabel(item)} ${metric(item.value)}`:'直接时薪'} · {item.matched?'命中':'未命中'} · {yuan(item.rate)} / h</small>)}{candidate?.items.map(item=><small key={item.id}>{item.name}：{premiumFieldOptions.find(option=>option.field===item.field)?.label||item.field} {yuan(item.value)} × {number(item.coefficient,4)} = {yuan(item.amount)}</small>)}</td><td>{calculation.matched===undefined?'—':calculation.matched?'命中':'未命中'}</td><td>{selection}</td><td className="numeric align-right strong">{yuan(calculation.amount)}</td></tr>;
   })}</tbody></table></div>:<p className="compensation-trace-formula">本行无逐规则金额，核算金额按冻结结果展示。</p>}
   {row.conditions.length>0&&<details className="compensation-evidence"><summary>条件取值与判断依据</summary>{row.conditions.map((evidence,index)=><p key={index}><strong>{ruleName(evidence.ruleId)} · {evidence.matched?'命中':'未命中'}</strong> · {conditionEvidenceText(evidence.condition)}<br/>{Object.entries(evidence.values).map(([field,value])=>`${conditionEvidenceValueLabel(field)}：${typeof value==='boolean'?(value?'是':'否'):value}`).join('；')}</p>)}</details>}
   <div className="settlement-outcome"><div><span>直播间月薪 · 比较金额后加补贴</span><p>各范围的保底金额取最大，加成金额和补贴分别求和。</p></div><strong>{`max（${amount(row.guarantee)}，${amount(row.additions)}）+ ${yuan(row.allowance)} = ${yuan(row.total)}`}</strong></div>
  </article>)}
  <div className="settlement-outcome"><span>员工月薪 · {rows.length} 个直播间</span><strong>{rows.map(row=>yuan(row.total)).join(' + ')} = {yuan(salary.total)}</strong></div>
 </>;
}

function CompensationSalaryModal({salary,onClose,month,version,result,rules}:{salary:Salary|null;onClose:()=>void;month:string;version?:number;result:CompensationResult;rules?:SalaryRule[]}) {
 const originalSalary=result.salaries.find(item=>item.employeeId===salary?.employeeId)??salary;
 return <Modal open={!!salary} onOpenChange={v=>!v&&onClose()} title={`${salary?.employeeName||''} · ${month} 薪资明细`} description={`数据集 v${version||1} · 合并规则与核算依据已冻结。`} wide>{salary&&originalSalary&&<>{salary.total!==originalSalary.total&&<div className="payroll-review-notice">当前已应用月薪 {yuan(salary.total)}；以下为原始核算依据，原始月薪 {yuan(originalSalary.total)}。</div>}<CompensationSalaryDetails salary={originalSalary} result={result} rules={rules}/></>}</Modal>;
}
