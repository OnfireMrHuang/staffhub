import * as XLSX from 'xlsx';
import type { CompensationResult, PayrollRowCalculation, Scope } from './compensation-rules';
import type { LiveMonthly } from './live-domain';
import { monthlyCellValue, monthlyColumns, monthlyCountFields, monthlyFields, pendingMonthlyFields } from './pages/LiveDatasetFields';

export type PayrollSettlementGroupKey = 'statistics' | Scope | 'result';
export interface PayrollSettlementColumn { key: string; label: string; group: PayrollSettlementGroupKey; numeric: boolean }
export interface PayrollSettlementGroup { key: PayrollSettlementGroupKey; label: string; count: number }
export interface PayrollSettlementLayout { columns: PayrollSettlementColumn[]; groups: PayrollSettlementGroup[] }

const scopes = [
  { key: 'global', label: '全局核算指标' },
  { key: 'rooms', label: '直播间核算指标' },
] as const;
const legacyScopes = [...scopes, { key: 'employees', label: '员工核算指标（历史）' }] as const;
const scopeFields = [
  { key: 'allowance', label: '补贴金额' },
  { key: 'guarantee', label: '保底金额' },
  { key: 'additions', label: '加成金额' },
  { key: 'premium', label: '系数加成后保费' },
] as const;
const numericStatistics = new Set<keyof LiveMonthly>(['year', ...monthlyFields.map(field => field.key)]);

function makeLayout(includeEmployees: boolean): PayrollSettlementLayout {
 const visibleScopes = includeEmployees ? legacyScopes : scopes;
 const columns: PayrollSettlementColumn[] = [
  ...monthlyColumns.map(field => ({ ...field, group: 'statistics' as const, numeric: numericStatistics.has(field.key) })),
  ...visibleScopes.flatMap(scope => scopeFields.map(field => ({ key: `${scope.key}.${field.key}`, label: field.label, group: scope.key, numeric: true }))),
  { key: 'result.allowance', label: '总计补贴', group: 'result', numeric: true },
  { key: 'result.premium', label: '系数加成后总计保费', group: 'result', numeric: true },
  { key: 'result.total', label: '总计月薪', group: 'result', numeric: true },
];
 const groups: PayrollSettlementGroup[] = [
  { key: 'statistics', label: '直播数据统计', count: monthlyColumns.length },
  ...visibleScopes.map(scope => ({ ...scope, count: scopeFields.length })),
  { key: 'result', label: '结果指标', count: 3 },
];
 return { columns, groups };
}
const currentLayout = makeLayout(false), legacyLayout = makeLayout(true);
export const payrollSettlementColumns = currentLayout.columns;
export const payrollSettlementGroups = currentLayout.groups;

/** Historical employee-scope evidence is retained; current results use only global and room groups. */
export function payrollSettlementLayout(result?: CompensationResult): PayrollSettlementLayout {
 const legacy = result?.rows.some(row => {
  const employees = row.scopes?.employees;
  return !!employees?.matchedRuleIds.length || !!employees && scopeFields.some(field => employees[field.key] !== 0)
   || row.ruleCalculations?.some(rule => rule.scope === 'employees') || row.durationGroups.some(group => group.scope === 'employees');
 });
 return legacy ? legacyLayout : currentLayout;
}

function statisticCell(row: PayrollRowCalculation, key: keyof LiveMonthly): string | number {
  if (row.statistics) return monthlyCellValue(row.statistics, key);
  if (pendingMonthlyFields.has(key)) return '待定义';
  // Older traces retain identity, but cannot reconstruct source metrics or profile data.
  if (key === 'month') return row.month?.slice(5) || '未定义';
  if (key === 'employeeId' || key === 'employeeName' || key === 'roomId' || key === 'roomName') return row[key] || '未定义';
  return '未定义';
}

/** Shared row values for the on-screen table and XLSX; formatting belongs to the consumer. */
export function payrollSettlementCells(row: PayrollRowCalculation, layout: PayrollSettlementLayout = currentLayout): (string | number)[] {
  const visibleScopes = layout.groups.some(group => group.key === 'employees') ? legacyScopes : scopes;
  return [
    ...monthlyColumns.map(field => statisticCell(row, field.key)),
    ...visibleScopes.flatMap(scope => scopeFields.map(field => row.scopes?.[scope.key]?.[field.key] ?? 0)),
    row.allowance, row.premium.after, row.total,
  ];
}

export function buildPayrollSettlementWorkbook(result: CompensationResult): XLSX.WorkBook {
  const { columns, groups } = payrollSettlementLayout(result);
  const workbook = XLSX.utils.book_new();
  const groupHeaders = Array<string>(columns.length).fill('');
  const merges: XLSX.Range[] = [];
  let firstColumn = 0;
  for (const group of groups) {
    groupHeaders[firstColumn] = group.label;
    merges.push({ s: { r: 0, c: firstColumn }, e: { r: 0, c: firstColumn + group.count - 1 } });
    firstColumn += group.count;
  }
  const detailSheet = XLSX.utils.aoa_to_sheet([
    groupHeaders,
    columns.map(column => column.label),
    ...result.rows.map(row => payrollSettlementCells(row, { columns, groups })),
  ]);
  detailSheet['!merges'] = merges;
  detailSheet['!cols'] = columns.map(column => ({ wch: Math.max(16, column.label.length * 2 + 2) }));
  detailSheet['!autofilter'] = { ref: `A2:${XLSX.utils.encode_cell({ r: result.rows.length + 1, c: columns.length - 1 })}` };
  result.rows.forEach((_, rowIndex) => columns.forEach((column, columnIndex) => {
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
