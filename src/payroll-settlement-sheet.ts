import * as XLSX from 'xlsx';
import type { CompensationResult, PayrollRowCalculation, Scope } from './compensation-rules';
import type { LiveMonthly } from './live-domain';
import { monthlyCellValue, monthlyColumns, monthlyCountFields, monthlyFields, pendingMonthlyFields } from './pages/LiveDatasetFields';

export type PayrollSettlementGroupKey = 'statistics' | Scope | 'result';
export interface PayrollSettlementColumn { key: string; label: string; group: PayrollSettlementGroupKey; numeric: boolean }
export interface PayrollSettlementGroup { key: PayrollSettlementGroupKey; label: string; count: number }

const scopes = [
  { key: 'global', label: '基础核算指标' },
  { key: 'rooms', label: '直播间核算指标' },
  { key: 'employees', label: '员工核算指标' },
] as const;
const scopeFields = [
  { key: 'allowance', label: '补贴金额' },
  { key: 'guarantee', label: '保底金额' },
  { key: 'additions', label: '加成金额' },
  { key: 'premium', label: '系数加成后保费' },
] as const;
const numericStatistics = new Set<keyof LiveMonthly>(['year', ...monthlyFields.map(field => field.key)]);

export const payrollSettlementColumns: PayrollSettlementColumn[] = [
  ...monthlyColumns.map(field => ({ ...field, group: 'statistics' as const, numeric: numericStatistics.has(field.key) })),
  ...scopes.flatMap(scope => scopeFields.map(field => ({ key: `${scope.key}.${field.key}`, label: field.label, group: scope.key, numeric: true }))),
  { key: 'result.allowance', label: '总计补贴', group: 'result', numeric: true },
  { key: 'result.premium', label: '系数加成后总计保费', group: 'result', numeric: true },
  { key: 'result.total', label: '总计月薪', group: 'result', numeric: true },
];
export const payrollSettlementGroups: PayrollSettlementGroup[] = [
  { key: 'statistics', label: '直播数据统计', count: monthlyColumns.length },
  ...scopes.map(scope => ({ ...scope, count: scopeFields.length })),
  { key: 'result', label: '结果指标', count: 3 },
];

function statisticCell(row: PayrollRowCalculation, key: keyof LiveMonthly): string | number {
  if (row.statistics) return monthlyCellValue(row.statistics, key);
  if (pendingMonthlyFields.has(key)) return '待定义';
  // Older traces retain identity, but cannot reconstruct source metrics or profile data.
  if (key === 'month') return row.month?.slice(5) || '未定义';
  if (key === 'employeeId' || key === 'employeeName' || key === 'roomId' || key === 'roomName') return row[key] || '未定义';
  return '未定义';
}

/** Shared row values for the on-screen table and XLSX; formatting belongs to the consumer. */
export function payrollSettlementCells(row: PayrollRowCalculation): (string | number)[] {
  return [
    ...monthlyColumns.map(field => statisticCell(row, field.key)),
    ...scopes.flatMap(scope => scopeFields.map(field => row.scopes?.[scope.key]?.[field.key] ?? 0)),
    row.allowance, row.premium.after, row.total,
  ];
}

export function buildPayrollSettlementWorkbook(result: CompensationResult): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const groupHeaders = Array<string>(payrollSettlementColumns.length).fill('');
  const merges: XLSX.Range[] = [];
  let firstColumn = 0;
  for (const group of payrollSettlementGroups) {
    groupHeaders[firstColumn] = group.label;
    merges.push({ s: { r: 0, c: firstColumn }, e: { r: 0, c: firstColumn + group.count - 1 } });
    firstColumn += group.count;
  }
  const detailSheet = XLSX.utils.aoa_to_sheet([
    groupHeaders,
    payrollSettlementColumns.map(column => column.label),
    ...result.rows.map(payrollSettlementCells),
  ]);
  detailSheet['!merges'] = merges;
  detailSheet['!cols'] = payrollSettlementColumns.map(column => ({ wch: Math.max(16, column.label.length * 2 + 2) }));
  detailSheet['!autofilter'] = { ref: `A2:${XLSX.utils.encode_cell({ r: result.rows.length + 1, c: payrollSettlementColumns.length - 1 })}` };
  result.rows.forEach((_, rowIndex) => payrollSettlementColumns.forEach((column, columnIndex) => {
    const cell = detailSheet[XLSX.utils.encode_cell({ r: rowIndex + 2, c: columnIndex })];
    if (cell?.t !== 'n') return;
    const statistic = column.group === 'statistics';
    cell.z = statistic && (column.key === 'year' || monthlyCountFields.has(column.key as keyof LiveMonthly)) ? '0'
      : statistic && column.key === 'roi' ? '0.0000' : '0.00';
  }));
  XLSX.utils.book_append_sheet(workbook, detailSheet, '主播月度薪酬核算表');

  const monthsByEmployee = new Map<string, Set<string>>();
  for (const row of result.rows) {
    if (!row.month) continue;
    const months = monthsByEmployee.get(row.employeeId) ?? new Set<string>();
    months.add(row.month);
    monthsByEmployee.set(row.employeeId, months);
  }
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['月份', '员工ID', '员工名称', '部门名称', '总计月薪'],
    ...result.salaries.map(salary => [
      [...(monthsByEmployee.get(salary.employeeId) ?? [])].sort().join('、') || '未定义',
      salary.employeeId, salary.employeeName, salary.departmentName, salary.total,
    ]),
  ]);
  summarySheet['!cols'] = Array.from({ length: 5 }, () => ({ wch: 20 }));
  result.salaries.forEach((_, index) => { summarySheet[XLSX.utils.encode_cell({ r: index + 1, c: 4 })].z = '0.00'; });
  XLSX.utils.book_append_sheet(workbook, summarySheet, '员工工资汇总');
  return workbook;
}
