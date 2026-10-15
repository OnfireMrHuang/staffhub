import type { Department, Employee } from './domain';
import type { AdvertisingProduct, LiveRoom } from './operations-domain';
import { deriveLiveMonthly, summarizeLiveDetails, validateLiveRecord, type LiveDetail, type LiveMonthly, type LiveRecord } from './live-domain';

export type DatasetTable = 'details' | 'monthly';
export interface DetailOverride { key: string; sourceMonth: string; row: LiveDetail }
export interface MonthlyOverride { key: string; sourceMonth: string; row: LiveMonthly }
export interface CorrectionAudit { id: string; table: DatasetTable; key: string; sourceMonth: string; targetMonth: string; reason: string; operator: string; at: string; action: '修改' | '恢复自动'; before: LiveDetail | LiveMonthly; after: LiveDetail | LiveMonthly | null }
export function monthlyRowKey(row: Pick<LiveMonthly, 'employeeId' | 'roomId' | 'month'>): string { return JSON.stringify([row.employeeId, row.roomId, row.month]); }

const detailFields = ['productId', 'roomId', 'date', 'start', 'end', 'hostId', 'buyerId', 'controlId', 'spend', 'revenue', 'clicks', 'conversions', 'orders', 'viewers'];
const monthlyFields = ['employeeId', 'departmentId', 'productId', 'roomId', 'month', 'hours', 'nightHours', 'earlyHours', 'spend', 'premium', 'nightSpend', 'earlySpend', 'sessions', 'nightSessions', 'earlySessions', 'hostNames'];
const detailAssociations = ['productId', 'roomId', 'date', 'start', 'end', 'hostId', 'buyerId', 'controlId'] as const;
const monthlyAssociations = ['employeeId', 'departmentId', 'productId', 'roomId', 'month'] as const;
const monthlyAmounts = ['hours', 'nightHours', 'earlyHours', 'spend', 'premium', 'nightSpend', 'earlySpend'] as const;
const monthlyCounts = ['sessions', 'nightSessions', 'earlySessions'] as const;
const validMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function checkPatch(patch: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(patch).some(field => !allowed.includes(field))) throw new Error('提交包含只读或不支持的字段');
}
function checkNumbers(row: object, amounts: readonly string[], counts: readonly string[]): void {
  const values = row as Record<string, unknown>;
  if (amounts.some(field => !nonnegative(values[field])) || counts.some(field => !nonnegative(values[field]) || !Number.isInteger(values[field]))) throw new Error('基础指标必须为有限非负数，计数必须为非负整数');
}
function checkJoined(employee: Employee, date: string, monthly = false): void {
  if (employee.status !== '在职') throw new Error(`${employee.name} 必须为在职员工`);
  if (!employee.joined) return;
  const value = /^\d{4}-\d{2}-\d{2}$/.test(employee.joined) ? Date.parse(`${employee.joined}T00:00:00Z`) : NaN;
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== employee.joined) throw new Error(`${employee.name} 入职日期无效`);
  if ((monthly ? employee.joined.slice(0, 7) : employee.joined) > date) throw new Error(`${employee.name} 统计日期在入职日期之前`);
}
function catalogNames(roomId: string, productId: string, rooms: LiveRoom[], products: AdvertisingProduct[]) {
  const room = rooms.find(item => item.id === roomId), product = products.find(item => item.id === productId);
  if (!room || !product || room.productId !== productId) throw new Error('产品与直播间关联无效或归属不一致');
  return {roomName: room.name, productName: product.name};
}
function shiftHours(row: Pick<LiveDetail, 'start' | 'end'>) {
  const start = Number(row.start.slice(0, 2)), end = Number(row.end.slice(0, 2));
  return {hours: end - start, nightHours: Math.max(0, Math.min(end, 6) - Math.max(start, 2)), earlyHours: Math.max(0, Math.min(end, 8) - Math.max(start, 6))};
}
const ratio = (numerator: number, denominator: number | undefined): number | null => denominator !== undefined && denominator > 0 ? numerator / denominator : null;

/** All editable values are bases; associations derive names and computed metrics are never accepted. */
export function prepareDetailCorrection(row: LiveDetail, patch: Record<string, unknown>, employees: Employee[], rooms: LiveRoom[], products: AdvertisingProduct[]): LiveDetail {
  checkPatch(patch, detailFields);
  const next = {...row, ...patch} as LiveDetail;
  if (detailAssociations.some(field => typeof next[field] !== 'string')) throw new Error('直播关联字段必须为有效字符串');
  validateLiveRecord(next, employees, rooms, products, [], []);
  checkNumbers(next, ['spend', 'revenue'], ['clicks', 'conversions', 'orders', 'viewers']);
  const names = catalogNames(next.roomId, next.productId, rooms, products);
  const staff = [next.hostId, next.buyerId, next.controlId].map(id => employees.find(employee => employee.id === id)!);
  if (detailAssociations.some(field => next[field] !== row[field])) staff.forEach(employee => checkJoined(employee, next.date));
  const changedTime = next.start !== row.start || next.end !== row.end;
  const shifts = shiftHours(next), original = shiftHours(row);
  // Unchanged times keep the actual source amount ratios. Changed times use time overlap.
  const nightSpend = changedTime || row.spend === 0 ? next.spend * (shifts.nightHours / shifts.hours) : next.spend * ((row.nightSpend ?? row.spend * (original.nightHours / original.hours)) / row.spend);
  const earlySpend = changedTime || row.spend === 0 ? next.spend * (shifts.earlyHours / shifts.hours) : next.spend * ((row.earlySpend ?? row.spend * (original.earlyHours / original.hours)) / row.spend);
  return {...next, ...names, hostName: staff[0].name, buyerName: staff[1].name, controlName: staff[2].name, nightSpend, earlySpend,
    roi: ratio(next.revenue, next.spend), clickCost: ratio(next.spend, next.clicks), conversionCost: ratio(next.spend, next.conversions),
    clickRate: ratio(next.clicks, next.clickRateDenominator), conversionRate: ratio(next.conversions, next.conversionRateDenominator)};
}

export function prepareMonthlyCorrection(row: LiveMonthly, patch: Record<string, unknown>, employees: Employee[], departments: Department[], rooms: LiveRoom[], products: AdvertisingProduct[]): LiveMonthly {
  checkPatch(patch, monthlyFields);
  const next = {...row, ...patch} as LiveMonthly;
  if (!validMonth(next.month)) throw new Error('统计月份无效');
  const employee = employees.find(item => item.id === next.employeeId), department = departments.find(item => item.id === next.departmentId);
  if (!employee || !department) throw new Error('统计员工或部门关联无效');
  const names = catalogNames(next.roomId, next.productId, rooms, products);
  if (monthlyAssociations.some(field => next[field] !== row[field])) checkJoined(employee, next.month, true);
  checkNumbers(next, monthlyAmounts, monthlyCounts);
  if (next.nightHours + next.earlyHours > next.hours + 1e-9) throw new Error('夜早班时长之和不能超过总时长');
  if (next.nightSpend + next.earlySpend > next.spend + 1e-9) throw new Error('夜早班消耗之和不能超过总消耗');
  if (next.nightSessions > next.sessions || next.earlySessions > next.sessions) throw new Error('每种班次场次不能超过总场次');
  if (!Array.isArray(next.hostNames) || next.hostNames.some(name => typeof name !== 'string' || !employees.some(employee => employee.name === name)) || new Set(next.hostNames).size !== next.hostNames.length) throw new Error('主播名称必须选择现有且不重复的员工');
  return {...next, ...names, employeeName: employee.name, departmentName: department.name, year: Number(next.month.slice(0, 4)), hostNames: [...next.hostNames], roles: [...next.roles], roi: ratio(next.premium, next.spend), hourlySpend: ratio(next.spend, next.hours), roiRank: next.spend > 0 ? next.roiRank : null};
}

/** Whole-row overlays remove their original identity even when moved out of the queried month. */
export function applyDatasetCorrections(baseDetails: LiveDetail[], detailOverrides: DetailOverride[], monthlyOverrides: MonthlyOverride[], employees: Employee[], departments: Department[], rooms: LiveRoom[], products: AdvertisingProduct[], month: string, contextRecords: LiveRecord[]): {details: LiveDetail[]; monthly: LiveMonthly[]} {
  if (!validMonth(month)) throw new Error('统计月份无效');
  if (new Set(detailOverrides.map(override => override.key)).size !== detailOverrides.length || new Set(monthlyOverrides.map(override => override.key)).size !== monthlyOverrides.length) throw new Error('人工覆盖原键重复');
  for (const override of detailOverrides) if (!validMonth(override.sourceMonth) || override.key !== override.row.id) throw new Error('明细覆盖原键或原月份无效');
  for (const override of monthlyOverrides) {
    let key: unknown;
    try { key = JSON.parse(override.key); } catch { throw new Error('月度覆盖原键无效'); }
    if (!validMonth(override.sourceMonth) || !Array.isArray(key) || key.length !== 3 || key.some(value => typeof value !== 'string' || !value.trim()) || key[2] !== override.sourceMonth) throw new Error('月度覆盖原键或原月份无效');
  }
  if (new Set(baseDetails.map(row => row.id)).size !== baseDetails.length) throw new Error('明细数据集原键重复');
  const changes = new Map(detailOverrides.map(override => [override.key, override.row]));
  const effectiveRecords = new Map(contextRecords.map(record => [record.id, record]));
  baseDetails.forEach(detail => { if(detail.sourceRecordId) effectiveRecords.delete(detail.sourceRecordId); });
  baseDetails.forEach(detail => effectiveRecords.set(detail.id, detail));
  changes.forEach((detail, key) => effectiveRecords.set(key, detail));
  const context = [...effectiveRecords.values()];
  context.forEach(record => validateLiveRecord(record, employees, rooms, products, context, []));
  const details = baseDetails.filter(row => !changes.has(row.id) && row.date.slice(0, 7) === month).map(row => ({...row}));
  for (const override of detailOverrides) if (override.row.date.slice(0, 7) === month) {
    // Re-derive computed fields without reallocating the persisted source shift amounts.
    const row = override.row;
    const prepared = prepareDetailCorrection(row, {}, employees, rooms, products);
    details.push({...prepared, nightSpend: row.nightSpend ?? prepared.nightSpend, earlySpend: row.earlySpend ?? prepared.earlySpend});
  }
  let monthly = summarizeLiveDetails(details, employees, departments, month, context);
  const originals = new Set(monthlyOverrides.map(override => override.key));
  monthly = monthly.filter(row => !originals.has(monthlyRowKey(row)));
  const grains = new Set(monthly.map(monthlyRowKey));
  for (const override of monthlyOverrides) if (override.row.month === month) {
    const row = prepareMonthlyCorrection(override.row, {}, employees, departments, rooms, products);
    const key = monthlyRowKey(row);
    if (grains.has(key)) throw new Error('月度数据集目标粒度重复，关联移动产生冲突');
    grains.add(key); monthly.push(row);
  }
  return {details, monthly: deriveLiveMonthly(monthly)};
}
