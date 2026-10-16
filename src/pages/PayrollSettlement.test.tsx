import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Payroll, { CompensationSalaryDetails } from './Payroll';
import type { CompensationResult } from '../compensation-rules';
import type { LiveMonthly } from '../live-domain';
import { useHub, type Batch } from '../store';

vi.mock('../store', async importOriginal => {
 const actual = await importOriginal<typeof import('../store')>();
 const current = Object.assign(((selector?: (state: ReturnType<typeof actual.useHub.getState>) => unknown) => selector ? selector(actual.useHub.getState()) : actual.useHub.getState()) as typeof actual.useHub, actual.useHub);
 return { ...actual, useHub: current };
});

const statistics: LiveMonthly = {
 employeeId: 'E01', employeeName: '测试主播', departmentId: 'D01', departmentName: '直播部',
 employeeJoinedOn: '2026-01-01', nonCompeteSigned: false, productId: 'P01', productName: '产品A',
 roomId: 'R01', roomName: '直播间A', roomOpenedOn: '2025-01-01', month: '2026-10', year: 2026,
 roles: ['主播'], hostNames: ['测试主播'], hours: 10, nightHours: 2, earlyHours: 2, regularHours: 6,
 sessions: 5, nightSessions: 2, earlySessions: 1, spend: 1000, nightSpend: 100, earlySpend: 100,
 regularSpend: 800, premium: 1000, nightPremium: 0, earlyPremium: 200, regularPremium: 800,
 roi: 1, hourlySpend: 100, roiRank: 2, spendRank: 1,
};
const salary = { employeeId: 'E01', employeeName: '测试主播', departmentName: '直播部', fixed: 0, commission: 1700, total: 1700, details: [] };
const firstRow = {
 employeeId: 'E01', employeeName: '测试主播', roomId: 'R01', roomName: '直播间A', month: '2026-10',
 matchedRuleIds: ['base', 'room', 'bonus'], statistics,
 scopes: {
  global: { allowance: 60, premium: 1250, guarantee: 900, additions: 600, matchedRuleIds: ['base'] },
  rooms: { allowance: 40, premium: 0, guarantee: 0, additions: 500, matchedRuleIds: ['room'] },
  employees: { allowance: 0, premium: 0, guarantee: 0, additions: 0, matchedRuleIds: [] },
 },
 guarantee: 900, additions: 1100, allowance: 100, allowanceItems: [],
 premium: { before: 1000, regular: 800, early: 200, coefficient: 2.25, after: 1250, roiBefore: 1, roiAfter: 1.25, rank: 1 },
 durationGroups: [], conditions: [], total: 1200,
 ruleCalculations: [
  { ruleId: 'base', scope: 'global', type: 'hourly', mode: 'guarantee', rate: 90, duration: 'hours', hours: 10, amount: 900, matched: true },
  { ruleId: 'room', scope: 'rooms', type: 'hourly', mode: 'additions', rate: 250, duration: 'earlyHours', hours: 2, amount: 500, matched: true },
  { ruleId: 'bonus', scope: 'global', type: 'hourly', mode: 'additions', rate: 60, duration: 'hours', hours: 10, amount: 600, matched: true },
 ],
};
const secondRow = {
 ...firstRow, roomId: 'R02', roomName: '直播间B', matchedRuleIds: [],
 statistics: { ...statistics, roomId: 'R02', roomName: '直播间B', employeeJoinedOn: undefined, regularPremium: undefined, roi: null },
 scopes: {
  global: { allowance: 0, premium: 0, guarantee: 500, additions: 0, matchedRuleIds: [] },
  rooms: { allowance: 0, premium: 0, guarantee: 0, additions: 0, matchedRuleIds: [] },
  employees: { allowance: 0, premium: 0, guarantee: 0, additions: 0, matchedRuleIds: [] },
 },
 guarantee: 500, additions: 0, allowance: 0, total: 500, ruleCalculations: [],
};
const result = { settlementVersion: 2, salaries: [salary], rows: [firstRow, secondRow], referenceDate: '2026-10-31' } as CompensationResult;
const rules = [{ id: 'base', name: '基础保底' }, { id: 'room', name: '早班加成' }, { id: 'bonus', name: '基础加成' }];
const textCells = (row: string) => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(match => match[1].replace(/<[^>]*>/g, ''));

it('shows every frozen monthly statistics column and all five settlement groups before the employee summary', () => {
 const before = useHub.getState();
 const batch: Batch = {
  month: '2026-10', status: '已核算', salaries: [salary], datasetVersion: 7, ruleVersion: 1, created: '2026-10-31', logs: [], compensationResult: result,
  snapshot: { records: [], adHours: [], roomHours: [], employees: [], departments: [], products: [], rooms: [], details: [], monthly: [], dataset: before.dataset, departmentRules: [], payrollTasks: [], compensationTasks: [] },
 };
 try {
  useHub.setState({ month: '2026-10', batch });
  const html = renderToStaticMarkup(<Payroll />);
  const table = html.match(/<table[^>]*aria-label="主播月度薪酬核算表"[^>]*>([\s\S]*?)<\/table>/)?.[1];
  expect(table, 'new settlements expose their frozen detail table').toBeDefined();
  const headerRows = [...table!.matchAll(/<thead>([\s\S]*?)<\/thead>/g)][0][1].match(/<tr[^>]*>[\s\S]*?<\/tr>/g)!;
  expect(headerRows).toHaveLength(2);
  expect(textCells(headerRows[0])).toEqual(['直播数据统计', '基础核算指标', '直播间核算指标', '员工核算指标', '结果指标']);
  expect([...headerRows[0].matchAll(/colSpan="(\d+)"/g)].map(match => Number(match[1]))).toEqual([33, 4, 4, 4, 3]);
  expect(textCells(headerRows[1])).toEqual([
   '员工ID', '员工名称', '部门ID', '部门名称', '入职日期', '是否签约竞业协议', '产品ID', '产品名称', '直播间ID', '直播间名称', '直播间开播时间', '年份', '月份',
   '总直播时长', '夜班直播时长', '早班直播时长', '正常直播时长', '夜班场次', '早班场次', '总消耗', '夜班消耗', '早班消耗', '正常消耗', '总保费', '夜班保费', '早班保费', '正常保费', 'ROI', '时耗', 'AD成本', '保单成本', 'ROI排名', '消耗排名',
   '补贴金额', '保底金额', '加成金额', '系数加成后保费', '补贴金额', '保底金额', '加成金额', '系数加成后保费', '补贴金额', '保底金额', '加成金额', '系数加成后保费', '总计补贴', '系数加成后总计保费', '总计月薪',
  ]);
  const rows = [...table!.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)][0][1].match(/<tr[^>]*>[\s\S]*?<\/tr>/g)!;
  expect(rows).toHaveLength(2);
  const first = textCells(rows[0]), second = textCells(rows[1]);
  expect(first).toHaveLength(48);
  expect(first.slice(23, 28)).toEqual(['1,000.00', '0.00', '200.00', '800.00', '1.0000']);
  expect(first.slice(-3)).toEqual(['100.00', '1,250.00', '1,200.00']);
  expect(first[11]).toBe('2026');
  expect(second[4]).toBe('未定义');
  expect(second[26]).toBe('未定义');
  expect(second[27]).toBe('未定义');
  expect(html).toContain('员工工资汇总');
  expect(html).toContain('确认并锁定');
  expect(html.indexOf('主播月度薪酬核算表')).toBeLessThan(html.indexOf('员工工资汇总'));
 } finally { useHub.setState(before, true); }
});

it('explains v2 settlement by scoped amounts, rule amounts, adjusted ROI, and the final amount comparison', () => {
 const html = renderToStaticMarkup(<CompensationSalaryDetails salary={salary} result={result} rules={rules} />);
 expect(html).toContain('每个直播间月薪 = max（最终保底金额，累计加成金额）+ 总计补贴');
 expect(html).toContain('员工月薪 = 各直播间月薪之和');
 expect(html).toContain('原始 ROI');
 expect(html).toContain('系数后 ROI');
 expect(html).toContain('1.2500');
 expect(html).toContain('逐规则金额');
 expect(html).toContain('基础保底');
 expect(html).toContain('¥900.00');
 expect(html).toContain('¥500.00');
 expect(html).toContain('max（¥900.00，¥1,100.00）+ ¥100.00 = ¥1,200.00');
 expect(html).toContain('系数保费仅用于后续 ROI 与排名计算，不直接计入工资');
 expect(html).not.toContain('各直播间、各时长的 max');
 const scopeRows = [...html.matchAll(/<tr[^>]*data-scope="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)];
 expect(scopeRows).toHaveLength(6);
 expect(textCells(scopeRows[0][2])).toEqual(['基础核算', '¥60.00', '¥900.00', '¥600.00', '¥1,250.00']);
 expect(textCells(scopeRows[2][2])).toEqual(['员工核算', '¥0.00', '¥0.00', '¥0.00', '¥0.00']);
 const secondTrace = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)][1][1];
 expect(secondTrace).toContain('原始 ROI<strong>未定义</strong>');
 expect(secondTrace).toContain('正常保费<strong>未定义</strong>');
});

it('preserves the historical detail formula when a snapshot has no settlement version', () => {
 const historical = { ...result, settlementVersion: undefined };
 const html = renderToStaticMarkup(<CompensationSalaryDetails salary={salary} result={historical} rules={rules} />);
 expect(html).toContain('各直播间、各时长的 max');
 expect(html).not.toContain('逐规则金额');
});

it('renders item-based premium expressions and each allowance count field from their frozen evidence', () => {
 const expanded = {
  ...result,
  rows: [{
   ...firstRow,
   premium: { ...firstRow.premium, candidates: [{ ruleId: 'weighted', amount: 1400, selected: true, items: [
    { id: 'all', name: '总保费权重', field: 'premium', coefficient: 1, value: 1000, amount: 1000 },
    { id: 'early', name: '早班加权项', field: 'earlyPremium', coefficient: 2, value: 200, amount: 400 },
   ] }] },
   allowanceItems: [
    { ruleId: 'early-allowance', field: 'earlySessions', sessions: 1, rate: 40, amount: 40 },
    { ruleId: 'night-allowance', field: 'nightSessions', sessions: 2, rate: 30, amount: 60 },
   ],
   ruleCalculations: [
    { ruleId: 'weighted', scope: 'global', type: 'premium', amount: 1400, matched: true },
    { ruleId: 'early-allowance', scope: 'rooms', type: 'allowance', rate: 40, amount: 40, matched: true },
    { ruleId: 'night-allowance', scope: 'global', type: 'allowance', rate: 30, amount: 60, matched: true },
   ],
  }],
 } as CompensationResult;
 const html = renderToStaticMarkup(<CompensationSalaryDetails salary={salary} result={expanded} />);
 expect(html).toContain('总保费权重：总保费 ¥1,000.00 × 1.0000 = ¥1,000.00');
 expect(html).toContain('早班加权项：早班保费 ¥200.00 × 2.0000 = ¥400.00');
 expect(html).toContain('早班场次 1 次 × ¥40.00 / 次');
 expect(html).toContain('夜班场次 2 次 × ¥30.00 / 次');
});
