import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { CompensationResult, PayrollRowCalculation } from './compensation-rules';
import type { LiveMonthly } from './live-domain';
import { buildPayrollSettlementWorkbook, payrollSettlementCells, payrollSettlementColumns, payrollSettlementGroups } from './payroll-settlement-sheet';

const statistics: LiveMonthly = {
  employeeId: 'e1', employeeName: '冻结姓名', departmentId: 'live', departmentName: '直播部',
  employeeJoinedOn: '2025-01-02', nonCompeteSigned: false, roomId: 'r1', roomName: '一号直播间',
  roomOpenedOn: '2025-02-03', productId: 'p1', productName: '产品', month: '2026-10', year: 2026,
  roles: ['主播'], hostNames: ['冻结姓名'], hours: 10, nightHours: 2, earlyHours: 3, regularHours: 5,
  spend: 100, nightSpend: 20, earlySpend: 30, regularSpend: 50, premium: 1000,
  nightPremium: 100, earlyPremium: 900, regularPremium: 0, roi: 10, hourlySpend: 10,
  sessions: 4, nightSessions: 2, earlySessions: 2, roiRank: 2, spendRank: 1,
};

function row(overrides: Partial<PayrollRowCalculation> = {}): PayrollRowCalculation {
  return {
    employeeId: 'e1', employeeName: '冻结姓名', roomId: 'r1', roomName: '一号直播间', month: '2026-10',
    matchedRuleIds: [], statistics: structuredClone(statistics),
    scopes: {
      global: { allowance: 20, guarantee: 1000, additions: 200, premium: 1000, matchedRuleIds: [] },
      rooms: { allowance: 40, guarantee: 1200, additions: 400, premium: 1500, matchedRuleIds: [] },
      employees: { allowance: 60, guarantee: 1400, additions: 600, premium: 1800, matchedRuleIds: [] },
    },
    allowance: 120, allowanceItems: [], guarantee: 1400, additions: 1200,
    premium: { before: 1000, regular: 0, early: 900, coefficient: 2, after: 1800, roiBefore: 10, roiAfter: 18, rank: 1 },
    durationGroups: [], conditions: [], ruleCalculations: [], total: 1520,
    ...overrides,
  };
}

const result = (rows = [row()]): CompensationResult => ({
  settlementVersion: 2, rows, referenceDate: '2099-12-31',
  salaries: [{ employeeId: 'e1', employeeName: '冻结姓名', departmentName: '直播部', fixed: 0, commission: 1520, total: 1520, details: [] }],
});

const statisticLabels = ['员工ID', '员工名称', '部门ID', '部门名称', '入职日期', '是否签约竞业协议', '产品ID', '产品名称', '直播间ID', '直播间名称', '直播间开播时间', '年份', '月份', '总直播时长', '夜班直播时长', '早班直播时长', '正常直播时长', '夜班场次', '早班场次', '总消耗', '夜班消耗', '早班消耗', '正常消耗', '总保费', '夜班保费', '早班保费', '正常保费', 'ROI', '时耗', 'AD成本', '保单成本', 'ROI排名', '消耗排名'];
const scopeLabels = ['补贴金额', '保底金额', '加成金额', '系数加成后保费'];

describe('layered payroll workbook', () => {
  it('exports all 48 columns under five merged group headers in the monthly statistics order', () => {
    const workbook = buildPayrollSettlementWorkbook(result());
    expect(workbook.SheetNames).toEqual(['主播月度薪酬核算表', '员工工资汇总']);
    const sheet = workbook.Sheets['主播月度薪酬核算表'];
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(sheet['!ref']).toBe('A1:AV3');
    expect(sheet['!merges']).toEqual([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 32 } },
      { s: { r: 0, c: 33 }, e: { r: 0, c: 36 } },
      { s: { r: 0, c: 37 }, e: { r: 0, c: 40 } },
      { s: { r: 0, c: 41 }, e: { r: 0, c: 44 } },
      { s: { r: 0, c: 45 }, e: { r: 0, c: 47 } },
    ]);
    expect([rows[0][0], rows[0][33], rows[0][37], rows[0][41], rows[0][45]])
      .toEqual(['直播数据统计', '基础核算指标', '直播间核算指标', '员工核算指标', '结果指标']);
    expect(rows[1]).toEqual([...statisticLabels, ...scopeLabels, ...scopeLabels, ...scopeLabels, '总计补贴', '系数加成后总计保费', '总计月薪']);
    expect(payrollSettlementGroups.map(group => group.count)).toEqual([33, 4, 4, 4, 3]);
    expect(payrollSettlementColumns.map(column => column.label)).toEqual(rows[1]);
    expect(new Set(payrollSettlementColumns.map(column => column.key)).size).toBe(48);
  });

  it('keeps frozen source values distinct from effective settlement values and exports numeric cells', () => {
    const input = result();
    const before = structuredClone(input);
    const workbook = buildPayrollSettlementWorkbook(input);
    const exported = XLSX.read(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true });
    const sheet = exported.Sheets['主播月度薪酬核算表'];
    const values = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 })[2];
    expect(values.slice(0, 14)).toEqual(['e1', '冻结姓名', 'live', '直播部', '2025-01-02', '否', 'p1', '产品', 'r1', '一号直播间', '2025-02-03', 2026, '10', 10]);
    expect(values.slice(23, 33)).toEqual([1000, 100, 900, 0, 10, 10, '待定义', '待定义', 2, 1]);
    expect(values.slice(33)).toEqual([20, 1000, 200, 1000, 40, 1200, 400, 1500, 60, 1400, 600, 1800, 120, 1800, 1520]);
    for (const column of [11, 13, 23, 26, 27, 31, 33, 46, 47]) {
      expect(sheet[XLSX.utils.encode_cell({ r: 2, c: column })].t).toBe('n');
    }
    expect(sheet.AB3.z).toBe('0.0000');
    expect(sheet.AV3.z).toBe('0.00');
    expect(values).toEqual(payrollSettlementCells(input.rows[0]));
    expect(input).toEqual(before);
  });

  it('distinguishes null or missing statistics from a numeric zero and defaults absent scopes to zero', () => {
    const trace = row({ statistics: { ...statistics, regularSpend: undefined, roi: null }, scopes: undefined });
    const values = payrollSettlementCells(trace);
    expect(values[22]).toBe('未定义');
    expect(values[26]).toBe(0);
    expect(values[27]).toBe('未定义');
    expect(values.slice(33, 45)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(values.slice(45)).toEqual([120, 1800, 1520]);
  });

  it('uses only frozen trace identity when statistics were not saved', () => {
    const values = payrollSettlementCells(row({ statistics: undefined }));
    expect(values.slice(0, 14)).toEqual(['e1', '冻结姓名', '未定义', '未定义', '未定义', '未定义', '未定义', '未定义', 'r1', '一号直播间', '未定义', '未定义', '10', '未定义']);
    expect(values.slice(23, 33)).toEqual(['未定义', '未定义', '未定义', '未定义', '未定义', '未定义', '待定义', '待定义', '未定义', '未定义']);
  });

  it('uses employee salary totals once per employee and derives each month from frozen rows', () => {
    const input = result([row(), row({ roomId: 'r2', roomName: '二号直播间' }), row({ employeeId: 'e2', month: '2026-09' })]);
    input.salaries[0].total = 1600.35;
    input.salaries.push({ employeeId: 'e2', employeeName: '乙', departmentName: '运营部', fixed: 0, commission: 0, total: 0, details: [] });
    const sheet = buildPayrollSettlementWorkbook(input).Sheets['员工工资汇总'];
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      ['月份', '员工ID', '员工名称', '部门名称', '总计月薪'],
      ['2026-10', 'e1', '冻结姓名', '直播部', 1600.35],
      ['2026-09', 'e2', '乙', '运营部', 0],
    ]);
    expect(sheet.E2.t).toBe('n');
    expect(sheet.E3.t).toBe('n');
  });

  it('retains both worksheet structures when no settlement rows exist', () => {
    const workbook = buildPayrollSettlementWorkbook({ settlementVersion: 2, rows: [], salaries: [], referenceDate: '2026-10-31' });
    expect(workbook.Sheets['主播月度薪酬核算表']['!ref']).toBe('A1:AV2');
    expect(workbook.Sheets['员工工资汇总']['!ref']).toBe('A1:E1');
  });
});
