import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
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
assert.equal(monthlyColumns.length, 33);
assert.equal(result.rows.length, expected.settledRowCount);
const near = (a, b, label) => assert.ok(typeof a === 'number' && Math.abs(a - b) < 0.000001, `${label}: ${a} ≠ ${b}`);
for (const row of result.rows) {
  const check = expected.rows.find(item => item.employeeId === row.employeeId && item.roomId === row.roomId);
  assert.ok(check);
  for (const scope of ['global', 'rooms', 'employees']) for (const metric of ['allowance', 'premium', 'guarantee', 'additions']) near(row.scopes[scope][metric], check.scopes[scope][metric], `${row.employeeName}/${row.roomName}/${scope}/${metric}`);
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
const moneyFormat = '#,##0.00;[Red](#,##0.00);"—"';
const integerFormat = '#,##0;[Red](#,##0);"—"';
const scopes = ['global', 'rooms', 'employees'];
const scopeNames = { global: '基础', rooms: '直播间', employees: '员工' };
const columnName = index => { let n = index + 1, s = ''; while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; };
const rawCol = field => columnName(monthlyColumns.findIndex(item => item.key === field));
const rawRef = (field, row) => `'月度核算明细'!${rawCol(field)}${row}`;
const rowKey = row => `${row.employeeId}|${row.roomId}`;
const sourceIndex = new Map(input.rows.map((row, index) => [rowKey(row), index + 7]));
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
base(wide, 'A1:AV15', colors.blue);
base(detail, `A1:P${cursor + 2}`, colors.teal);
heading(summary, '主播月度薪酬核算示例', 'A3:I3');
heading(wide, '月度核算明细', 'A3:AV3');
heading(detail, '逐规则计算明细', 'A3:P3');
note(summary, 'A4', `${input.month}　模拟数据，不是真实工资。金额单位：人民币元。`);
note(wide, 'A4', '每行对应员工、直播间、月份；前33列保留原始统计。金额为元，时长为小时。');
note(detail, 'A4', '模拟规则。数量引用月度统计，金额由数量 × 费率 + 正常保费计算；同范围保底与保费取最大值，加成与补贴求和。');

// The two-level table is an explicit requirement. Its raw values are authoritative
// source inputs. Only the four host rows participate in settlement formulas.
const groups = [
  ['A5:AG5', '直播数据统计', colors.blue],
  ['AH5:AK5', '基础核算指标', colors.teal],
  ['AL5:AO5', '直播间核算指标', colors.purple],
  ['AP5:AS5', '员工核算指标', colors.gold],
  ['AT5:AV5', '结果指标', colors.navy],
];
for (const [address, label, fill] of groups) { wide.mergeCells(address); wide.getRange(address).values = [[label]]; header(wide, address, fill); wide.getRange(address).format.borders = { preset: 'none' }; }
const metricLabels = ['补贴', '保底', '加成', '系数后保费'];
wide.getRange('A6:AV6').values = [[...monthlyColumns.map(item => item.label), ...metricLabels, ...metricLabels, ...metricLabels, '总补贴', '系数后总保费', '总计月薪']];
header(wide, 'A6:AG6', colors.blue); header(wide, 'AH6:AK6', colors.teal); header(wide, 'AL6:AO6', colors.purple); header(wide, 'AP6:AS6', colors.gold); header(wide, 'AT6:AV6');
wide.getRange('A5:AV5').format.rowHeight = 28;
wide.getRange('A6:AV6').format.rowHeight = 42;
wide.getRange('A7:AG11').values = input.rows.map(row => monthlyColumns.map(({ key }) => ['employeeJoinedOn', 'roomOpenedOn'].includes(key) ? new Date(`${row[key]}T00:00:00Z`) : key === 'month' ? new Date(`${row.month}-01T00:00:00Z`) : monthlyCellValue(row, key)));
stripe(wide, 7, 11, 'AV');
wide.getRange('A7:AG11').format.font.color = '#365D86';
wide.getRange('A6:AV11').format.columnWidth = 14;
for (const col of ['A', 'C', 'G', 'I']) wide.getRange(`${col}6:${col}11`).format.columnWidth = 23;
for (const col of ['B', 'D', 'H', 'J']) wide.getRange(`${col}6:${col}11`).format.columnWidth = 15;
wide.getRange('F6:F11').format.columnWidth = 18;
wide.getRange('E7:E11').setNumberFormat('yyyy-mm-dd');
wide.getRange('K7:K11').setNumberFormat('yyyy-mm-dd');
wide.getRange('M7:M11').setNumberFormat('yyyy-mm');
wide.getRange('N7:AV11').setNumberFormat(moneyFormat);
for (const field of ['year', 'nightSessions', 'earlySessions', 'roiRank', 'spendRank']) wide.getRange(`${rawCol(field)}7:${rawCol(field)}11`).setNumberFormat(integerFormat);
wide.getRange('L7:AV11').format.horizontalAlignment = 'right';
wide.getRange('AH6:AV11').format.columnWidth = 16;
wide.getRange('AT7:AV10').format.fill = '#E8EFF5';
wide.getRange('AV7:AV10').format.font.bold = true;
wide.getRange('A11:AV11').format.font.color = '#8994A1';
note(wide, 'A13', '吴策仅具备投手身份，保留其输入以展示筛选口径，核算栏留空。AD成本、保单成本尚未定义。');
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
    `=SUMIFS('月度核算明细'!$AT$7:$AT$10,'月度核算明细'!$A$7:$A$10,B${r})`,
    `=SUMIFS('月度核算明细'!$AU$7:$AU$10,'月度核算明细'!$A$7:$A$10,B${r})`,
    `=SUMIFS('月度核算明细'!$AV$7:$AV$10,'月度核算明细'!$A$7:$A$10,B${r})`,
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
summary.getRange('A16:I16').values = [['员工名称', '直播间', '三类保底最大值', '三类加成合计', '总补贴', '总计月薪', '有效总保费', '有效ROI', '同房主播排名']];
header(summary, 'A16:I16');
summary.getRange('A16:I16').format.rowHeight = 40;
summary.getRange('A16:I16').format.horizontalAlignment = 'center';
summary.getRange('A11:I13').format.rowHeight = 12;
for (const row of result.rows) {
  const sr = sourceIndex.get(rowKey(row)), r = summaryIndex.get(rowKey(row));
  summary.getRange(`A${r}:B${r}`).values = [[row.employeeName, row.roomName]];
  summary.getRange(`C${r}:I${r}`).formulas = [[
    `=MAX('月度核算明细'!AI${sr},'月度核算明细'!AM${sr},'月度核算明细'!AQ${sr})`,
    `=SUM('月度核算明细'!AJ${sr},'月度核算明细'!AN${sr},'月度核算明细'!AR${sr})`,
    `='月度核算明细'!AT${sr}`, `='月度核算明细'!AV${sr}`, `='月度核算明细'!AU${sr}`,
    `=IF(${rawRef('spend', sr)}=0,"n.a.",G${r}/${rawRef('spend', sr)})`,
    `=1+COUNTIFS($B$17:$B$20,B${r},$H$17:$H$20,">"&H${r})`,
  ]];
}
stripe(summary, 17, 20, 'I');
summary.getRange('C17:H20').setNumberFormat(moneyFormat);
summary.getRange('I17:I20').setNumberFormat(integerFormat);
summary.getRange('F17:F20').format.font.bold = true;
note(summary, 'A23', '每行月薪 = MAX（三类保底最大值，三类加成合计）+ 总补贴。系数后保费只用于指标计算。');
note(summary, 'A24', '同房主播按有效ROI降序排名；并列时采用 1、1、3 的竞赛排名。陈雨兼任场控，仍只核算一次。');
note(summary, 'A25', '本例含5行源数据、4行主播核算、3名主播；吴策为投手，未纳入主播月薪。');
note(summary, 'A26', '来源：固定虚构演示样例。员工范围与适用规则固定；身份、规则或数据粒度改变后须在系统重新核算。');
for (const [col, width] of Object.entries({ A: 13, B: 23, C: 17, D: 16, E: 18, F: 16, G: 18, H: 13, I: 16 })) summary.getRange(`${col}1:${col}27`).format.columnWidth = width;
summary.getRange('C7:I20').format.horizontalAlignment = 'right';
summary.getRange('A7:I20').format.rowHeight = 28;
summary.getRange('A16:I16').format.rowHeight = 40;

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
  for (const [scopeIndex, scope] of scopes.entries()) {
    for (const [metricIndex, metric] of ['allowance', 'guarantee', 'additions', 'premium'].entries()) {
      const candidates = row.ruleCalculations.filter(calc => calc.scope === scope && (metric === 'allowance' || metric === 'premium' ? calc.type === metric : calc.type === 'hourly' && calc.mode === metric));
      const refs = candidates.map(calc => `'逐规则计算'!J${ruleRows.get(`${rowKey(row)}|${calc.ruleId}`)}`);
      const col = columnName(33 + scopeIndex * 4 + metricIndex);
      wide.getRange(`${col}${r}`).formulas = [[refs.length ? `=${metric === 'guarantee' || metric === 'premium' ? 'MAX' : 'SUM'}(${refs.join(',')})` : '=0']];
    }
  }
  wide.getRange(`AT${r}:AV${r}`).formulas = [[`=SUM(AH${r},AL${r},AP${r})`, `=MAX(AK${r},AO${r},AS${r})`, `=ROUND(MAX(AI${r},AM${r},AQ${r},SUM(AJ${r},AN${r},AR${r}))+AT${r},2)`]];
}

wb.recalculate();
function verify() {
  for (const row of expected.rows) {
    const r = sourceIndex.get(rowKey(row)), s = summaryIndex.get(rowKey(row));
    near(wide.getRange(`AV${r}`).values[0][0], row.total, 'Excel room salary');
    near(wide.getRange(`AU${r}`).values[0][0], row.effectivePremium, 'Excel premium');
    near(summary.getRange(`H${s}`).values[0][0], row.effectiveRoi, 'Excel ROI');
    near(summary.getRange(`I${s}`).values[0][0], row.effectiveRank, 'Excel rank');
  }
  for (let i = 0; i < expected.employees.length; i++) near(summary.getRange(`F${i + 7}`).values[0][0], expected.employees[i].total, 'Excel employee salary');
  near(summary.getRange('F10').values[0][0], expected.total, 'Excel total salary');
  for (const record of records) near(detail.getRange(`J${record.excelRow}`).values[0][0], record.calculation.amount, 'Excel rule arithmetic');
}
verify();
// Demonstrate that summaries recalculate, and restore all temporary edits.
const allowanceRecord = records.find(record => record.row.employeeId === 'example-lin' && record.row.roomId === 'example-room-a' && record.rule.id === 'g-night-allowance');
const rateCell = detail.getRange(`H${allowanceRecord.excelRow}`);
rateCell.values = [[21]];
near(summary.getRange('F7').values[0][0], 9540, 'allowance propagation');
near(summary.getRange('F10').values[0][0], 18225, 'allowance total propagation');
rateCell.values = [[20]];
// Change the employee premium coefficient so the first room's ROI order changes.
const premiumRecord = records.find(record => record.row.employeeId === 'example-lin' && record.row.roomId === 'example-room-a' && record.rule.id === 'e-premium');
const coefficientCell = detail.getRange(`M${premiumRecord.excelRow}`);
coefficientCell.values = [[1]];
near(summary.getRange('H17').values[0][0], 3, 'premium recalculation');
near(summary.getRange('I17').values[0][0], 2, 'rank recalculation');
near(summary.getRange('I19').values[0][0], 1, 'peer rank recalculation');
coefficientCell.values = [[3]];
wb.recalculate(); verify();

const inspections = [];
for (const range of ['员工月薪汇总!A6:F10', '员工月薪汇总!A16:I20', '月度核算明细!AH5:AV11', '逐规则计算!F7:J20']) {
  const inspection = await wb.inspect({ kind: 'table', range, include: 'values,formulas', tableMaxRows: 16, tableMaxCols: 16, maxChars: 16000 });
  inspections.push({ range, result: inspection.ndjson });
}
const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 100 }, summary: 'final formula error scan', maxChars: 4000 });
await fs.writeFile(path.join(outputDir, 'verification.json'), JSON.stringify({ engineVersion: result.settlementVersion, sourceRows: input.rows.length, settlementRows: result.rows.length, employees: expected.employees, total: summary.getRange('F10').values[0][0], dynamicChecks: ['allowance to row/employee/grand total', 'premium coefficient to ROI and peer ranking'], formulaErrorScan: errors.ndjson, inspections }, null, 2));
console.log(errors.ndjson);
for (const [sheetName, range, name] of [
  ['员工月薪汇总', 'A1:I27', 'summary.png'],
  ['月度核算明细', 'A5:M11', 'monthly-dimensions.png'],
  ['月度核算明细', 'N5:AG11', 'monthly-statistics.png'],
  ['月度核算明细', 'AH5:AV11', 'monthly-settlement.png'],
  ['逐规则计算', 'A5:L20', 'rules-first.png'],
  ['逐规则计算', 'A43:L57', 'rules-last.png'],
  ['逐规则计算', 'L5:P20', 'rules-settings.png'],
]) {
  const image = await wb.render({ sheetName, range, scale: 1.5, format: 'png' });
  await fs.writeFile(path.join(outputDir, name), new Uint8Array(await image.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(wb);
const target = path.join(outputDir, '主播月度薪酬核算示例.xlsx');
await output.save(target);
console.log(JSON.stringify({ target, total: expected.total, sourceRows: input.rows.length, settlementRows: result.rows.length, ruleCalculations: records.length }));
