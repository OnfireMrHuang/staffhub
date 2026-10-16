import type { CompensationResult } from '../compensation-rules';
import type { LiveMonthly } from '../live-domain';
import { number } from '../components';
import { monthlyCountFields } from './LiveDatasetFields';
import { payrollSettlementCells, payrollSettlementLayout } from '../payroll-settlement-sheet';
import '../payroll-settlement.css';

export default function PayrollSettlementTable({ result, search = '' }: { result: CompensationResult; search?: string }) {
 const layout = payrollSettlementLayout(result);
 const query = search.trim().toLocaleLowerCase();
 const rows = result.rows.filter(row => `${row.employeeId} ${row.employeeName}`.toLocaleLowerCase().includes(query));
 return <>
  <div className="table-scroll settlement-scroll" role="region" aria-label="主播核算明细，可横向滚动" tabIndex={0}>
   <table className="settlement-table" aria-label="主播月度薪酬核算表">
    <thead>
     <tr>{layout.groups.map(group => <th key={group.key} scope="colgroup" colSpan={group.count} className={`settlement-${group.key}`}><span className="settlement-group-label">{group.label}</span></th>)}</tr>
     <tr>{layout.columns.map(column => <th key={column.key} scope="col" className={`settlement-${column.group}`} data-column={column.key}>{column.label}</th>)}</tr>
    </thead>
    <tbody>{rows.map(row => <tr key={`${row.employeeId}-${row.roomId}-${row.month}`}>
     {payrollSettlementCells(row, layout).map((value, index) => {
      const column = layout.columns[index];
      const digits = column.key === 'roi' ? 4 : monthlyCountFields.has(column.key as keyof LiveMonthly) ? 0 : 2;
      const display = typeof value === 'number' && column.key !== 'year' ? number(value, digits) : value;
      return <td key={column.key} className={`settlement-${column.group}${column.numeric ? ' numeric align-right' : ''}${column.key === 'result.total' ? ' strong' : ''}`} data-column={column.key}>{display}</td>;
     })}
    </tr>)}</tbody>
   </table>
  </div>
  {!rows.length && <p className="settlement-empty">当前条件下暂无主播核算明细。</p>}
  <div className="table-foot"><span>共 {rows.length} 行 · 员工 × 直播间 × 月份</span><span>左右滚动查看全部 {layout.columns.length} 列 · 统计数据为核算时冻结原值</span></div>
 </>;
}
