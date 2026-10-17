import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
import { payrollSettlementExample as input } from '../../src/payroll-settlement-example.ts';
import { calculateCompensation } from '../../src/compensation-rules.ts';
import { monthlyColumns, monthlyCellValue } from '../../src/pages/LiveDatasetFields.ts';

// Reproduce with the bundled Node runtime. The adjacent node_modules symlink points
// to the dependency runtime returned by load_workspace_dependencies.
const outputDir = path.dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(await fs.readFile(path.resolve(outputDir, '../../docs/examples/layered-payroll/expected.json'), 'utf8'));
const result = calculateCompensation(input.rows, input.employees, input.departments, input.rooms, input.rules, input.month);
assert.equal(result.settlementVersion, 2);
assert.equal(monthlyColumns.length, 35);
assert.equal(result.rows.length, expected.settledRowCount);
const near = (a, b, label) => assert.ok(typeof a === 'number' && Math.abs(a - b) < 0.000001, `${label}: ${a} ≠ ${b}`);
for (const row of result.rows) {
  const check = expected.rows.find(item => item.employeeId === row.employeeId && item.roomId === row.roomId);
  assert.ok(check);
  for (const scope of ['global', 'rooms']) for (const metric of ['allowance', 'premium', 'guarantee', 'additions']) near(row.scopes[scope][metric], check.scopes[scope][metric], `${row.employeeName}/${row.roomName}/${scope}/${metric}`);
  near(row.total, check.total, 'row total');
  near(row.premium.after, check.effectivePremium, 'effective premium');
  near(row.premium.roiAfter, check.effectiveRoi, 'effective ROI');
  near(row.premium.rank, check.effectiveRank, 'effective rank');
  for (const rule of row.ruleCalculations) near(rule.amount, check.rules[rule.ruleId], `rule ${rule.ruleId}`);
}
for (const employee of result.salaries) near(employee.total, expected.employees.find(item => item.employeeId === employee.employeeId).total, 'employee total');

const wb = Workbook.create();
const summary = wb.worksheets.add('员工月薪汇总');
const wide = wb.worksheets.add('月度核算明细');
const detail = wb.worksheets.add('逐规则计算');
const colors = { navy: '#24364B', blue: '#315F86', teal: '#3F766F', purple: '#6C5A84', gold: '#976C28', text: '#243447', muted: '#64748B', pale: '#F2F5F8', input: '#FCF7EA', white: '#FFFFFF', line: '#D7DFE7' };
const moneyFormat = '#,##0.00;[Red](#,##0.00);0.00';
const integerFormat = '#,##0;[Red](#,##0);0';
const scopes = ['global', 'rooms'];
const scopeNames = { global: '全局', rooms: '直播间' };
const columnName = index => { let n = index + 1, s = ''; while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; };
const metricFields = ['allowance', 'guarantee', 'additions', 'premium'];
const metricLabels = ['补贴金额', '保底金额', '加成金额', '系数加成后保费'];
const scopeCol = (scope, field) => columnName(monthlyColumns.length + scopes.indexOf(scope) * metricFields.length + metricFields.indexOf(field));
const resultCol = field => columnName(monthlyColumns.length + scopes.length * metricFields.length + ['allowance', 'premium', 'total'].indexOf(field));
const rawLastCol = columnName(monthlyColumns.length - 1), firstCalcCol = scopeCol('global', 'allowance'), lastCol = resultCol('total');
const scopeRefs = (field, row, sheet = '') => scopes.map(scope => `${sheet}${scopeCol(scope, field)}${row}`).join(',');
const rawCol = field => columnName(monthlyColumns.findIndex(item => item.key === field));
const rawRef = (field, row) => `'月度核算明细'!${rawCol(field)}${row}`;
const rowKey = row => `${row.employeeId}|${row.roomId}`;
const settledKeys = new Set(result.rows.map(rowKey));
const hostInputs = input.rows.filter(row => settledKeys.has(rowKey(row)));
const sourceIndex = new Map(hostInputs.map((row, index) => [rowKey(row), index + 7]));
const summaryIndex = new Map(result.rows.map((row, index) => [rowKey(row), index + 17]));
const ruleRows = new Map();
const records = [];
let cursor = 7;
for (const row of result.rows) {
  for (const calculation of row.ruleCalculations) {
    const rule = input.rules.find(item => item.id === calculation.ruleId);
    const record = { row, calculation, rule, excelRow: cursor++, sourceRow: sourceIndex.get(rowKey(row)) };
    ruleRows.set(`${rowKey(row)}|${rule.id}`, record.excelRow);
    records.push(record);
  }
}

function base(sheet, range, color) {
  sheet.showGridLines = false;
  sheet.tabColor = color;
  const area = sheet.getRange(range);
  area.format.font = { name: 'Arial', size: 10, color: colors.text };
  area.format.verticalAlignment = 'center';
  area.format.rowHeight = 24;
  area.format.fill = colors.white;
}
function heading(sheet, title, range) {
  sheet.getRange('A2').values = [[title]];
  sheet.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: colors.navy };
  sheet.getRange('A2').format.rowHeight = 31;
  sheet.getRange(range).format.borders = { bottom: { style: 'thin', color: colors.line } };
}
function header(sheet, address, fill = colors.navy) {
  sheet.getRange(address).format = { fill, font: { name: 'Arial', size: 10, color: colors.white, bold: true }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true, borders: { insideVertical: { style: 'thin', color: colors.white } } };
}
function stripe(sheet, first, last, lastCol) {
  for (let row = first; row <= last; row++) if ((row - first) % 2 === 1) sheet.getRange(`A${row}:${lastCol}${row}`).format.fill = colors.pale;
}
function note(sheet, cell, text) {
  sheet.getRange(cell).values = [[text]];
  sheet.getRange(cell).format.font = { name: 'Arial', size: 10, color: colors.muted, italic: true };
}

base(summary, 'A1:I27', colors.navy);
base(wide, `A1:${lastCol}15`, colors.blue);
base(detail, `A1:P${cursor + 2}`, colors.teal);
heading(summary, '主播月度薪酬核算示例', 'A3:I3');
heading(wide, '月度核算明细', `A3:${lastCol}3`);
heading(detail, '逐规则计算明细', 'A3:P3');
note(summary, 'A4', `${input.month}　模拟数据，不是真实工资。金额单位：人民币元。`);
note(wide, 'A4', `每行对应员工、直播间、月份；前${monthlyColumns.length}列保留原始统计。金额为元，时长为小时。`);
note(detail, 'A4', '模拟规则。数量引用月度统计，金额由数量 × 费率 + 正常保费计算；同范围保底与保费取最大值，加成与补贴求和。');

// The two-level table is an explicit requirement. Its raw values are authoritative
// source inputs. Only the four host rows participate in settlement formulas.
const groups = [
  [`A5:${rawLastCol}5`, '直播数据统计', colors.blue],
  [`${scopeCol('global', 'allowance')}5:${scopeCol('global', 'premium')}5`, '全局核算指标', colors.teal],
  [`${scopeCol('rooms', 'allowance')}5:${scopeCol('rooms', 'premium')}5`, '直播间核算指标', colors.purple],
  [`${resultCol('allowance')}5:${lastCol}5`, '结果指标', colors.navy],
];
for (const [address, label, fill] of groups) { wide.mergeCells(address); wide.getRange(address).values = [[label]]; header(wide, address, fill); wide.getRange(address).format.borders = { preset: 'none' }; }
wide.getRange(`A6:${lastCol}6`).values = [[...monthlyColumns.map(item => item.label), ...scopes.flatMap(() => metricLabels), '总计补贴', '系数加成后总计保费', '总计月薪']];
for (const [address, , fill] of groups) header(wide, address.replaceAll('5', '6'), fill);
wide.getRange(`A5:${lastCol}5`).format.rowHeight = 28;
wide.getRange(`A6:${lastCol}6`).format.rowHeight = 42;
wide.getRange(`A7:${rawLastCol}10`).values = hostInputs.map(row => monthlyColumns.map(({ key }) => ['employeeJoinedOn', 'roomOpenedOn'].includes(key) ? new Date(`${row[key]}T00:00:00Z`) : key === 'month' ? new Date(`${row.month}-01T00:00:00Z`) : monthlyCellValue(row, key)));
stripe(wide, 7, 10, lastCol);
wide.getRange(`A7:${rawLastCol}10`).format.font.color = '#365D86';
wide.getRange(`A6:${lastCol}10`).format.columnWidth = 14;
for (const col of ['A', 'C', 'G', 'I']) wide.getRange(`${col}6:${col}10`).format.columnWidth = 23;
for (const col of ['B', 'D', 'H', 'J']) wide.getRange(`${col}6:${col}10`).format.columnWidth = 15;
wide.getRange('F6:F10').format.columnWidth = 18;
wide.getRange('E7:E10').setNumberFormat('yyyy-mm-dd');
wide.getRange('K7:K10').setNumberFormat('yyyy-mm-dd');
wide.getRange('M7:M10').setNumberFormat('yyyy-mm');
wide.getRange(`N7:${lastCol}10`).setNumberFormat(moneyFormat);
for (const field of ['year', 'nightSessions', 'earlySessions', 'roiRank', 'spendRank', 'waitingSalaryDays']) wide.getRange(`${rawCol(field)}7:${rawCol(field)}10`).setNumberFormat(integerFormat);
wide.getRange('AI6:AI10').format.columnWidth = 20;
wide.getRange(`L7:${lastCol}10`).format.horizontalAlignment = 'right';
wide.getRange(`${firstCalcCol}6:${lastCol}10`).format.columnWidth = 18;
wide.getRange(`${resultCol('allowance')}7:${lastCol}10`).format.fill = '#E8EFF5';
wide.getRange(`${lastCol}7:${lastCol}10`).format.font.bold = true;
note(wide, 'A12', '5行来源数据筛选为4行主播核算。吴策仅具备投手身份，已排除。');
note(wide, 'A13', '等待薪资天数、过去3个月平均时薪未提供；AD成本、保单成本待定义。');
note(wide, 'A14', '原始ROI和排名保留；时薪规则使用各范围系数后保费最大值形成的有效ROI及同房主播排名。');
wide.freezePanes.freezeRows(6); wide.freezePanes.freezeColumns(2);

// A compact manager view answers the employee-level question first.
summary.getRange('A6:F6').values = [['员工名称', '员工ID', '核算行数', '总补贴', '系数后总保费', '总计月薪']];
header(summary, 'A6:F6');
summary.getRange('A6:F6').format.rowHeight = 34;
for (let i = 0; i < result.salaries.length; i++) {
  const employee = result.salaries[i], r = 7 + i;
  summary.getRange(`A${r}:B${r}`).values = [[employee.employeeName, employee.employeeId]];
  summary.getRange(`C${r}:F${r}`).formulas = [[
    `=COUNTIFS('月度核算明细'!$A$7:$A$10,B${r})`,
    ...['allowance', 'premium', 'total'].map(field => `=SUMIFS('月度核算明细'!$${resultCol(field)}$7:$${resultCol(field)}$10,'月度核算明细'!$A$7:$A$10,B${r})`),
  ]];
}
stripe(summary, 7, 9, 'F');
summary.getRange('A10').values = [['合计']];
summary.getRange('C10:F10').formulas = [['=SUM(C7:C9)', '=SUM(D7:D9)', '=SUM(E7:E9)', '=SUM(F7:F9)']];
summary.getRange('A10:F10').format = { fill: '#E8EFF5', font: { bold: true, color: colors.navy }, borders: { top: { style: 'thin', color: colors.line } } };
summary.getRange('D7:F10').setNumberFormat(moneyFormat);
summary.getRange('C7:C10').setNumberFormat(integerFormat);
summary.getRange('F7:F10').format.font.bold = true;
summary.getRange('A14').values = [['各直播间结算过程']];
summary.getRange('A14').format.font.bold = true;
note(summary, 'A15', '先按员工和直播间核算，再把该员工各房间月薪相加。');
summary.getRange('A16:I16').values = [['员工名称', '直播间', '两类保底最大值', '两类加成合计', '总补贴', '总计月薪', '有效总保费', '有效ROI', '同房主播排名']];
header(summary, 'A16:I16');
summary.getRange('A16:I16').format.rowHeight = 40;
for (const row of result.rows) {
  const sr = sourceIndex.get(rowKey(row)), r = summaryIndex.get(rowKey(row));
  summary.getRange(`A${r}:B${r}`).values = [[row.employeeName, row.roomName]];
  summary.getRange(`C${r}:I${r}`).formulas = [[
    `=MAX(${scopeRefs('guarantee', sr, "'月度核算明细'!")})`,
    `=SUM(${scopeRefs('additions', sr, "'月度核算明细'!")})`,
    ...['allowance', 'total', 'premium'].map(field => `='月度核算明细'!${resultCol(field)}${sr}`),
    `=IF(${rawRef('spend', sr)}=0,"n.a.",G${r}/${rawRef('spend', sr)})`,
    `=1+COUNTIFS($B$17:$B$20,B${r},$H$17:$H$20,">"&H${r})`,
  ]];
}
stripe(summary, 17, 20, 'I');
summary.getRange('C17:H20').setNumberFormat(moneyFormat);
summary.getRange('I17:I20').setNumberFormat(integerFormat);
summary.getRange('F17:F20').format.font.bold = true;
note(summary, 'A23', '每行月薪 = MAX（全局与直播间保底最大值，两类加成合计）+ 总补贴。系数后保费用于ROI与排名。');
note(summary, 'A24', '同房主播按有效ROI降序排名；并列时采用 1、1、3 的竞赛排名。陈雨兼任场控，仍只核算一次。');
note(summary, 'A25', '本例含5行源数据、4行主播核算、3名主播；吴策为投手，未纳入主播月薪。');
note(summary, 'A26', '来源：固定虚构演示样例。仅使用全局和直播间规则；身份、规则或数据粒度改变后须在系统重新核算。');
note(summary, 'A27', '兼容输入：旧式条件保费；当前新建保费规则采用固定系数项目。');
for (const [col, width] of Object.entries({ A: 13, B: 23, C: 17, D: 16, E: 18, F: 16, G: 18, H: 13, I: 16 })) summary.getRange(`${col}1:${col}27`).format.columnWidth = width;
summary.getRange('C7:I20').format.horizontalAlignment = 'right';
summary.getRange('A7:I20').format.rowHeight = 28;
summary.getRange('A16:I16').format.rowHeight = 40;
summary.getRange('A16:I16').format.horizontalAlignment = 'center';
summary.getRange('A11:I13').format.rowHeight = 12;

// This fixture uses legacy normal + early × coefficient premium rules.
// Scope matching is the immutable exported run; scalar arithmetic and the metric
// bands below remain inspectable Excel formulas, with no terminal checks feeding them.
detail.getRange('A6:P6').values = [['员工', '直播间', '范围', '规则名称', '核算类型', '数量指标', '数量 / 保费', '费率 / 系数', '正常保费', '规则金额', null, '命中说明', '设定系数', '条件指标', '阈值', '规则ID']];
header(detail, 'A6:J6', colors.teal);
header(detail, 'M6:P6', colors.teal);
detail.getRange('L6').format.font.bold = true;
detail.getRange('A6:P6').format.rowHeight = 40;
const fieldNames = Object.fromEntries(monthlyColumns.map(item => [item.key, item.label]));
for (const { row, calculation: calc, rule, excelRow: r, sourceRow: sr } of records) {
  const kind = calc.type === 'premium' ? '系数保费' : calc.type === 'allowance' ? '补贴' : calc.mode === 'guarantee' ? '保底' : '加成';
  const quantityField = calc.type === 'premium' ? 'earlyPremium' : calc.type === 'allowance' ? rule.allowance.field : calc.duration;
  detail.getRange(`A${r}:G${r}`).values = [[row.employeeName, row.roomName, scopeNames[calc.scope], rule.name, kind, fieldNames[quantityField], null]];
  detail.getRange(`G${r}`).formulas = [[`=${rawRef(quantityField, sr)}`]];
  detail.getRange(`I${r}`).values = [[0]];
  detail.getRange(`P${r}`).values = [[rule.id]];
  if (calc.type === 'premium') {
    assert.ok('coefficient' in rule.premium, 'Update builder for item-based premium fixture');
    const cond = rule.premium.condition.children[0];
    assert.equal(cond.field, 'monthly.earlySessions'); assert.equal(cond.operator, 'gte');
    detail.getRange(`H${r}`).formulas = [[`=IF(${rawRef('earlySessions', sr)}>=O${r},M${r},1)`]];
    detail.getRange(`I${r}`).formulas = [[`=${rawRef('regularPremium', sr)}`]];
    detail.getRange(`L${r}:O${r}`).values = [['达阈值用设定系数，否则用1', rule.premium.coefficient, '早班场次 ≥', cond.value]];
  } else if (calc.type === 'allowance') {
    detail.getRange(`H${r}`).values = [[calc.rate]];
    detail.getRange(`L${r}`).values = [['场次 × 每场补贴']];
  } else {
    const item = rule.hourly.items[0];
    if (item.kind === 'metric') {
      const metricCell = `'员工月薪汇总'!${item.field === 'roi' ? 'H' : 'I'}${summaryIndex.get(rowKey(row))}`;
      const clauses = item.bands.map(band => {
        const terms = band.keyType === 'exact' ? [`${metricCell}=${band.exact}`] : [...(band.min === undefined ? [] : [`${metricCell}${band.includeMin ? '>=' : '>'}${band.min}`]), ...(band.max === undefined ? [] : [`${metricCell}${band.includeMax ? '<=' : '<'}${band.max}`])];
        return { condition: terms.length === 1 ? terms[0] : `AND(${terms.join(',')})`, rate: band.rate };
      });
      let formula = 'NA()'; for (const clause of [...clauses].reverse()) formula = `IF(${clause.condition},${clause.rate},${formula})`;
      detail.getRange(`H${r}`).formulas = [[`=${formula}`]];
      detail.getRange(`L${r}`).values = [[item.field === 'roi' ? '有效ROI：低于3为20；≥3为45' : '有效排名：第1为10；其余为5']];
    } else {
      detail.getRange(`H${r}`).values = [[calc.rate]];
      detail.getRange(`L${r}`).values = [['所选时长 × 规则时薪']];
    }
  }
  detail.getRange(`J${r}`).formulas = [[`=ROUND(G${r}*H${r}+I${r},2)`]];
}
stripe(detail, 7, cursor - 1, 'P');
detail.getRange(`G7:J${cursor - 1}`).setNumberFormat(moneyFormat);
detail.getRange(`M7:M${cursor - 1}`).setNumberFormat('0.0');
detail.getRange(`O7:O${cursor - 1}`).setNumberFormat('0');
detail.getRange(`H7:H${cursor - 1}`).format.fill = colors.input;
detail.getRange(`M7:O${cursor - 1}`).format.fill = colors.input;
detail.getRange(`K6:L${cursor - 1}`).format.fill = colors.white;
detail.getRange(`J7:J${cursor - 1}`).format.font.bold = true;
for (const [col, width] of Object.entries({ A: 12, B: 18, C: 10, D: 30, E: 12, F: 18, G: 15, H: 14, I: 15, J: 15, K: 3, L: 42, M: 13, N: 17, O: 10, P: 27 })) detail.getRange(`${col}1:${col}${cursor}`).format.columnWidth = width;
detail.freezePanes.freezeRows(6); detail.freezePanes.freezeColumns(2);

for (const row of result.rows) {
  const r = sourceIndex.get(rowKey(row));
  for (const scope of scopes) {
    for (const metric of metricFields) {
      const candidates = row.ruleCalculations.filter(calc => calc.scope === scope && (metric === 'allowance' || metric === 'premium' ? calc.type === metric : calc.type === 'hourly' && calc.mode === metric));
      const refs = candidates.map(calc => `'逐规则计算'!J${ruleRows.get(`${rowKey(row)}|${calc.ruleId}`)}`);
      const col = scopeCol(scope, metric);
      wide.getRange(`${col}${r}`).formulas = [[refs.length ? `=${metric === 'guarantee' || metric === 'premium' ? 'MAX' : 'SUM'}(${refs.join(',')})` : '=0']];
    }
  }
  wide.getRange(`${resultCol('allowance')}${r}:${lastCol}${r}`).formulas = [[`=SUM(${scopeRefs('allowance', r)})`, `=MAX(${scopeRefs('premium', r)})`, `=ROUND(MAX(${scopeRefs('guarantee', r)},SUM(${scopeRefs('additions', r)}))+${resultCol('allowance')}${r},2)`]];
}

wb.recalculate();
function verify() {
  for (const row of expected.rows) {
    const r = sourceIndex.get(rowKey(row)), s = summaryIndex.get(rowKey(row));
    near(wide.getRange(`${lastCol}${r}`).values[0][0], row.total, 'Excel room salary');
    near(wide.getRange(`${resultCol('allowance')}${r}`).values[0][0], row.totalAllowance, 'Excel allowance');
    near(wide.getRange(`${resultCol('premium')}${r}`).values[0][0], row.effectivePremium, 'Excel premium');
    near(summary.getRange(`C${s}`).values[0][0], row.finalGuarantee, 'Excel guarantee');
    near(summary.getRange(`D${s}`).values[0][0], row.totalAdditions, 'Excel additions');
    for (const scope of scopes) for (const metric of metricFields) near(wide.getRange(`${scopeCol(scope, metric)}${r}`).values[0][0], row.scopes[scope][metric], `Excel ${scope}/${metric}`);
    near(summary.getRange(`H${s}`).values[0][0], row.effectiveRoi, 'Excel ROI');
    near(summary.getRange(`I${s}`).values[0][0], row.effectiveRank, 'Excel rank');
  }
  for (let i = 0; i < expected.employees.length; i++) near(summary.getRange(`F${i + 7}`).values[0][0], expected.employees[i].total, 'Excel employee salary');
  near(summary.getRange('F10').values[0][0], expected.total, 'Excel total salary');
  assert.equal(records.length, 56);
  for (const record of records) {
    const check = expected.rows.find(row => rowKey(row) === rowKey(record.row));
    near(detail.getRange(`J${record.excelRow}`).values[0][0], check.rules[record.rule.id], 'Excel rule arithmetic');
  }
  for (const field of ['waitingSalaryDays', 'past3MonthsAvgHourlyRate']) for (let row = 7; row <= 10; row++) assert.equal(wide.getRange(`${rawCol(field)}${row}`).values[0][0], '未定义');
  assert.equal(wide.getRange('A11').values[0][0], null);
}
verify();
// Demonstrate that summaries recalculate, and restore all temporary edits.
const allowanceRecord = records.find(record => record.row.employeeId === 'example-lin' && record.row.roomId === 'example-room-a' && record.rule.id === 'g-night-allowance');
const rateCell = detail.getRange(`H${allowanceRecord.excelRow}`);
rateCell.values = [[21]];
near(summary.getRange('F7').values[0][0], 9540, 'allowance propagation');
near(summary.getRange('F10').values[0][0], expected.total + 10, 'allowance total propagation');
rateCell.values = [[20]];
// Change a global premium coefficient so the first room's ROI order changes.
const premiumRecord = records.find(record => record.row.employeeId === 'example-lin' && record.row.roomId === 'example-room-a' && record.rule.id === 'g-extra-premium');
const coefficientCell = detail.getRange(`M${premiumRecord.excelRow}`);
coefficientCell.values = [[1]];
near(summary.getRange('H17').values[0][0], 3, 'premium recalculation');
near(summary.getRange('I17').values[0][0], 2, 'rank recalculation');
near(summary.getRange('I19').values[0][0], 1, 'peer rank recalculation');
near(summary.getRange('F17').values[0][0], 7050, 'coefficient through hourly bands to salary');
near(summary.getRange('F7').values[0][0], 9330, 'coefficient through employee salary');
near(summary.getRange('F10').values[0][0], expected.total - 200, 'coefficient through total salary');
coefficientCell.values = [[3]];
wb.recalculate(); verify();

const inspections = [];
for (const range of ['员工月薪汇总!A6:F10', '员工月薪汇总!A16:I20', `月度核算明细!${firstCalcCol}5:${lastCol}11`, '逐规则计算!F7:J20']) {
  const inspection = await wb.inspect({ kind: 'table', range, include: 'values,formulas', tableMaxRows: 16, tableMaxCols: 16, maxChars: 16000 });
  inspections.push({ range, result: inspection.ndjson });
}
const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 100 }, summary: 'final formula error scan', maxChars: 4000 });
await fs.writeFile(path.join(outputDir, 'verification.json'), JSON.stringify({ engineVersion: result.settlementVersion, sourceRows: input.rows.length, settlementRows: result.rows.length, statisticColumns: monthlyColumns.length, settlementColumns: monthlyColumns.length + scopes.length * metricFields.length + 3, headerGroups: groups.map(([,label]) => label), ruleCalculations: records.length, employees: expected.employees, total: summary.getRange('F10').values[0][0], verificationCoverage: ['every rule against independent expected amounts', 'every scope metric', 'ROI and room ranking', 'row and employee totals', 'undefined new source metrics retained', 'only host rows imported'], dynamicChecks: ['allowance to row/employee/grand total', 'premium coefficient to ROI, peer ranking, hourly bands and row/employee/grand total'], formulaErrorScan: errors.ndjson, inspections }, null, 2));
console.log(errors.ndjson);
for (const [sheetName, range, name] of [
  ['员工月薪汇总', 'A1:I27', 'summary.png'],
  ['月度核算明细', 'A5:M11', 'monthly-dimensions.png'],
  ['月度核算明细', `N5:${rawLastCol}11`, 'monthly-statistics.png'],
  ['月度核算明细', `${firstCalcCol}5:${lastCol}11`, 'monthly-settlement.png'],
  ['逐规则计算', 'A5:L20', 'rules-first.png'],
  ['逐规则计算', `A${cursor - 14}:L${cursor - 1}`, 'rules-last.png'],
  ['逐规则计算', 'L5:P20', 'rules-settings.png'],
].filter(([, , name]) => !process.env.RENDER_ONLY || name === process.env.RENDER_ONLY)) {
  const image = await wb.render({ sheetName, range, scale: 1.5, format: 'png' });
  await fs.writeFile(path.join(outputDir, name), new Uint8Array(await image.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(wb);
const target = path.join(outputDir, '主播月度薪酬核算示例.xlsx');
await output.save(target);
// Inspect the saved OOXML so cached results, headers and panes are verified after export.
const exportCheck = String.raw`
import json, pathlib, sys, zipfile, xml.etree.ElementTree as ET
target, output, total = sys.argv[1:]
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
checks = {}
with zipfile.ZipFile(target) as archive:
    shared = ET.fromstring(archive.read('xl/sharedStrings.xml'))
    strings = [''.join(item.itertext()) for item in shared]
    def text_value(cell):
        value = cell.find('s:v', ns).text
        return strings[int(value)] if cell.attrib.get('t') == 's' else value
    assert not any('员工核算指标' in text or '三类' in text for text in strings)
    for i in range(1, 4):
        root = ET.fromstring(archive.read(f'xl/worksheets/sheet{i}.xml'))
        pane = root.find('s:sheetViews/s:sheetView/s:pane', ns)
        merges = [cell.attrib['ref'] for cell in root.findall('s:mergeCells/s:mergeCell', ns)]
        errors = [cell.attrib['r'] for cell in root.findall('.//s:c', ns) if cell.attrib.get('t') == 'e']
        checks[f'sheet{i}'] = {'pane': None if pane is None else pane.attrib, 'merges': merges, 'errors': errors}
        assert not errors
        if i in (2, 3):
            assert pane.attrib['xSplit'] == '2' and pane.attrib['ySplit'] == '6' and pane.attrib['topLeftCell'] == 'C7'
        if i == 2:
            assert merges == ['A5:AI5', 'AJ5:AM5', 'AN5:AQ5', 'AR5:AT5']
            cells = {cell.attrib['r']: cell for cell in root.findall('.//s:c', ns)}
            headers = [cell for address, cell in cells.items() if address.rstrip('0123456789') and address[len(address.rstrip('0123456789')):] == '6']
            assert len(headers) == 46
            for address in ['AH7', 'AI7', 'AH8', 'AI8', 'AH9', 'AI9', 'AH10', 'AI10']:
                assert text_value(cells[address]) == '未定义'
            assert 'A11' not in cells or cells['A11'].find('s:v', ns) is None
            checks['sheet2']['columnCount'] = len(headers)
            checks['sheet2']['hostDataRows'] = 4
            checks['sheet2']['groupLabels'] = [text_value(cells[address]) for address in ['A5', 'AJ5', 'AN5', 'AR5']]
        if i == 1:
            cell = root.find(".//s:c[@r='F10']", ns)
            cached = cell.find('s:v', ns).text
            assert float(cached) == float(total)
            checks['totalCell'] = {'formula': cell.find('s:f', ns).text, 'cachedValue': cached}
checks['fileBytes'] = pathlib.Path(target).stat().st_size
pathlib.Path(output).write_text(json.dumps(checks, ensure_ascii=False, indent=2))
print(json.dumps({'exportVerified': True, 'total': float(total), 'columns': 46, 'groups': 4}))
`;
console.log(execFileSync('/Users/huangwenwu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3', ['-c', exportCheck, target, path.join(outputDir, 'export-verification.json'), String(expected.total)], { encoding: 'utf8' }).trim());
console.log(JSON.stringify({ target, total: expected.total, sourceRows: input.rows.length, settlementRows: result.rows.length, ruleCalculations: records.length }));
