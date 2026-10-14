import type { AdvertisingProduct, LiveRoom } from './operations-domain';
import type { Department, Employee, WorkRow } from './domain';

export interface LiveRecord { id: string; roomId: string; productId: string; date: string; start: string; end: string; hostId: string; buyerId: string; controlId: string; version: number }
export interface AdHourly { id: string; roomId: string; productId: string; date: string; start: string; end: string; spend: number; payment: number; impressions: number; clicks: number; conversions: number; conversionCost: number; conversionRate: number; orders: number }
export interface RoomHourly { clickRateDenominator?: number; conversionRateDenominator?: number; id: string; roomId: string; productId: string; accountId: string; date: string; start: string; end: string; spend: number; revenue: number; clicks: number; clickRate: number; clickCost: number; conversions: number; conversionRate: number; conversionCost: number; roi: number; orders: number; viewers: number; fans: number; tips: number }
export interface LiveDetail extends LiveRecord { productName: string; roomName: string; hostName: string; buyerName: string; controlName: string; spend: number; revenue: number; clicks: number; clickRate: number | null; clickCost: number | null; conversions: number; conversionRate: number | null; conversionCost: number | null; roi: number | null; orders: number; viewers: number; fans: number; tips: number; nightSpend?: number; earlySpend?: number; clickRateDenominator?: number; conversionRateDenominator?: number }
export interface LiveMonthly extends Omit<WorkRow, 'projectId' | 'roi' | 'hourlySpend'> { roomId: string; roomName: string; productId: string; productName: string; roles: string[]; hostNames: string[]; year: number; nightHours: number; earlyHours: number; nightSpend: number; earlySpend: number; roi: number | null; hourlySpend: number | null; roiRank: number | null; sessions: number; nightSessions: number; earlySessions: number }
export type LiveTemplateRow = Pick<LiveRecord, 'roomId' | 'date' | 'start' | 'end'>;

const hourText = (minute: number) => `${String(minute / 60).padStart(2, '0')}:00`;
function dateValue(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期必须为有效 YYYY-MM-DD');
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('日期不存在');
  return value;
}
function minuteValue(value: string, isEnd = false): number {
  if (!/^(?:[01]\d|2[0-3]):00$/.test(value) && !(isEnd && value === '24:00')) throw new Error('直播开始和结束时间必须整小时对齐（HH:00，结束可24:00）');
  return Number(value.slice(0, 2)) * 60;
}
function interval(record: Pick<LiveRecord, 'date' | 'start' | 'end'>) {
  const day = dateValue(record.date), start = minuteValue(record.start), end = minuteValue(record.end, true);
  if (start >= end) throw new Error('结束时间必须晚于开始时间；跨日请按日期拆分记录');
  return {start, end, absoluteStart: day + start * 60000, absoluteEnd: day + end * 60000};
}
export function generateLiveTemplate(roomIds: string[], date: string, start: string, end: string, stepMinutes: number): LiveTemplateRow[] {
  const range = interval({date, start, end});
  if (!roomIds.length || roomIds.some(id => !id.trim())) throw new Error('请选择有效直播间');
  if (new Set(roomIds).size !== roomIds.length) throw new Error('直播间不能重复');
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0 || stepMinutes % 60) throw new Error('模板分片必须为正整小时倍数');
  return roomIds.flatMap(roomId => Array.from({length: Math.ceil((range.end - range.start) / stepMinutes)}, (_, i) => ({roomId, date, start: hourText(range.start + i * stepMinutes), end: hourText(Math.min(range.end, range.start + (i + 1) * stepMinutes))})));
}
export function validateLiveRecord(record: LiveRecord, employees: Employee[], rooms: LiveRoom[], products: AdvertisingProduct[], existing: LiveRecord[], archivedMonths: string[]): void {
  const range = interval(record);
  if (!record.id?.trim() || !Number.isInteger(record.version) || record.version < 1) throw new Error('直播记录 ID 或版本无效');
  const room = rooms.find(room => room.id === record.roomId);
  if (!room || !room.platformAccountId?.trim()) throw new Error('直播记录直播间或直播账户无效');
  if (room.productId !== record.productId || !products.some(product => product.id === record.productId)) throw new Error('直播记录产品与直播间归属不一致');
  if ([record.hostId, record.buyerId, record.controlId].some(id => !employees.some(e => e.id === id))) throw new Error('直播记录岗位员工 ID 无效');
  const replaced = existing.find(r => r.id === record.id);
  if (archivedMonths.includes(record.date.slice(0, 7)) || (replaced && archivedMonths.includes(replaced.date.slice(0, 7)))) throw new Error('归档月份直播记录只读，不能新增、修改或移出');
  for (const other of existing) {
    if (other.id === record.id || other.roomId !== record.roomId) continue;
    const otherRange = interval(other);
    if (range.absoluteStart < otherRange.absoluteEnd && range.absoluteEnd > otherRange.absoluteStart) throw new Error('同直播间直播记录时间重叠');
  }
}
const totalFields = ['spend', 'revenue', 'clicks', 'conversions', 'orders', 'viewers', 'fans', 'tips'] as const;
const numericFields = [...totalFields, 'clickRate', 'clickCost', 'conversionRate', 'conversionCost', 'roi'] as const;
function aggregate(source: RoomHourly[]): Pick<LiveDetail, typeof numericFields[number]> {
  const sum = (field: typeof totalFields[number]) => source.reduce((value, row) => value + row[field], 0);
  const totals = Object.fromEntries(totalFields.map(field => [field, sum(field)])) as Record<typeof totalFields[number], number>;
  const rate = (field: 'clickRate' | 'conversionRate', denominator: 'clickRateDenominator' | 'conversionRateDenominator', numerator: number): number | null => {
    if (source.length === 1 && source[0][denominator] === undefined) return source[0][field];
    if (!source.length || source.some(row => row[denominator] === undefined)) return null;
    const totalDenominator = source.reduce((value, row) => value + row[denominator]!, 0);
    return totalDenominator > 0 ? numerator / totalDenominator : null;
  };
  return {...totals, clickRate: rate('clickRate', 'clickRateDenominator', totals.clicks), clickCost: totals.clicks ? totals.spend / totals.clicks : null, conversionRate: rate('conversionRate', 'conversionRateDenominator', totals.conversions), conversionCost: totals.conversions ? totals.spend / totals.conversions : null, roi: totals.spend ? totals.revenue / totals.spend : null};
}
/** Rates are ratios (0.1 = 10%). Multi-source rates require explicit, adapter-verified denominators;
 * viewer counts are never assumed to be marketing exposures. Undefined rates and costs are null. */
export function buildLiveStatistics(records: LiveRecord[], roomHours: RoomHourly[], employees: Employee[], departments: Department[], rooms: LiveRoom[], products: AdvertisingProduct[], month: string): {details: LiveDetail[]; monthly: LiveMonthly[]} {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('统计月份无效');
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('直播记录 ID 重复');
  if (new Set(employees.map(e => e.id)).size !== employees.length || new Set(rooms.map(room => room.id)).size !== rooms.length || new Set(products.map(product => product.id)).size !== products.length) throw new Error('员工或直播间 ID 重复');
  records.forEach(record => validateLiveRecord(record, employees, rooms, products, records, []));
  const selected = records.filter(r => r.date.slice(0, 7) === month);
  const selectedRooms = new Set(selected.map(r => r.roomId));
  const sourceIndex = new Map<string, RoomHourly>();
  const sourceIds = new Set<string>();
  for (const source of roomHours.filter(r => r.date.slice(0, 7) === month && selectedRooms.has(r.roomId))) {
    const range = interval(source);
    if (range.end - range.start !== 60) throw new Error('直播间来源必须为完整一个小时');
    const room = rooms.find(room => room.id === source.roomId)!;
    if (source.productId !== room.productId || !products.some(product => product.id === source.productId)) throw new Error('直播间来源产品与直播间归属不一致');
    if (source.accountId !== room.platformAccountId) throw new Error('直播间来源账户不属于直播间绑定账户');
    if (numericFields.some(field => !Number.isFinite(source[field]) || source[field] < 0) || [source.clickRateDenominator, source.conversionRateDenominator].some(value => value !== undefined && (!Number.isFinite(value) || value < 0))) throw new Error('直播间来源存在无效数值');
    const key = JSON.stringify([source.productId, source.roomId, source.date, source.start]);
    if (sourceIndex.has(key) || sourceIds.has(source.id)) throw new Error('直播间来源小时或 ID 重复');
    sourceIds.add(source.id); sourceIndex.set(key, source);
  }
  const details: LiveDetail[] = [];
  for (const record of selected) {
    const room = rooms.find(room => room.id === record.roomId)!;
    const product = products.find(product => product.id === record.productId)!;
    const range = interval(record), source: RoomHourly[] = [], night: RoomHourly[] = [], early: RoomHourly[] = [];
    for (let minute = range.start; minute < range.end; minute += 60) {
      const hour = sourceIndex.get(JSON.stringify([product.id, room.id, record.date, hourText(minute)]));
      if (!hour) throw new Error(`${room.name} ${record.date} ${hourText(minute)} 账户 ${room.platformAccountId} 缺少直播间小时来源`);
      source.push(hour); if (minute >= 120 && minute < 360) night.push(hour); if (minute >= 360 && minute < 480) early.push(hour);
    }
    const sums = aggregate(source);
    const denominator = (field: 'clickRateDenominator' | 'conversionRateDenominator') => source.every(hour => hour[field] !== undefined) ? source.reduce((sum, hour) => sum + hour[field]!, 0) : undefined;
    details.push({...record, productName: product.name, roomName: room.name, hostName: employees.find(e => e.id === record.hostId)!.name, buyerName: employees.find(e => e.id === record.buyerId)!.name, controlName: employees.find(e => e.id === record.controlId)!.name, ...sums, nightSpend: aggregate(night).spend, earlySpend: aggregate(early).spend, clickRateDenominator: denominator('clickRateDenominator'), conversionRateDenominator: denominator('conversionRateDenominator')});
  }
  return {details, monthly: summarizeLiveDetails(details, employees, departments, month, records)};
}

/** Derive ratios only from effective base values, ranking valid ROI within one room/month. */
export function deriveLiveMonthly(rows: LiveMonthly[]): LiveMonthly[] {
  const monthly = rows.map(row => ({...row, roi: row.spend > 0 ? row.premium / row.spend : null, hourlySpend: row.hours > 0 ? row.spend / row.hours : null}));
  return monthly.map(row => ({...row, roiRank: row.roi === null ? null : 1 + monthly.filter(other => other.roomId === row.roomId && other.month === row.month && other.roi !== null && other.roi > row.roi!).length}));
}

/** Rebuild all monthly contributions from corrected details. Context preserves continuous cross-month sessions. */
export function summarizeLiveDetails(details: LiveDetail[], employees: Employee[], departments: Department[], month: string, contextRecords: LiveRecord[] = []): LiveMonthly[] {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('统计月份无效');
  const effective = new Map(contextRecords.map(record => [record.id, record]));
  details.forEach(detail => effective.set(detail.id, detail));
  const sessionByRecord = new Map<string, string>();
  const previousByRoom = new Map<string, {record: LiveRecord; session: string}>();
  for (const record of [...effective.values()].sort((a, b) => interval(a).absoluteStart - interval(b).absoluteStart || a.id.localeCompare(b.id))) {
    const previous = previousByRoom.get(record.roomId);
    const sameTeam = previous && previous.record.hostId === record.hostId && previous.record.buyerId === record.buyerId && previous.record.controlId === record.controlId;
    const continuous = sameTeam && interval(previous.record).absoluteEnd === interval(record).absoluteStart;
    const session = continuous ? previous.session : JSON.stringify([record.roomId, record.hostId, record.buyerId, record.controlId, interval(record).absoluteStart]);
    sessionByRecord.set(record.id, session); previousByRoom.set(record.roomId, {record, session});
  }
  type Group = {row: LiveMonthly; sessions: Set<string>; night: Set<string>; early: Set<string>};
  const groups = new Map<string, Group>();
  for (const record of details.filter(detail => detail.date.slice(0, 7) === month)) {
    const range = interval(record);
    const nightHours = Math.max(0, Math.min(range.end, 360) - Math.max(range.start, 120)) / 60;
    const earlyHours = Math.max(0, Math.min(range.end, 480) - Math.max(range.start, 360)) / 60;
    const rolePairs = [[record.hostId, '主播'], [record.buyerId, '投手'], [record.controlId, '场控']] as const;
    for (const employeeId of new Set(rolePairs.map(([id]) => id))) {
      const key = JSON.stringify([employeeId, record.roomId, month]), employee = employees.find(e => e.id === employeeId);
      if (!employee) throw new Error('直播统计岗位员工 ID 无效');
      let group = groups.get(key);
      if (!group) {
        const department = departments.find(d => d.id === employee.departmentId);
        if (!department) throw new Error(`${employee.name} 部门归属无效`);
        group = {row: {employeeId, employeeName: employee.name, departmentId: department.id, departmentName: department.name, roomId: record.roomId, roomName: record.roomName, productId: record.productId, productName: record.productName, month, year: Number(month.slice(0, 4)), roles: [], hostNames: [], hours: 0, spend: 0, premium: 0, roi: null, hourlySpend: null, nightHours: 0, earlyHours: 0, nightSpend: 0, earlySpend: 0, sessions: 0, nightSessions: 0, earlySessions: 0, roiRank: null}, sessions: new Set(), night: new Set(), early: new Set()};
        groups.set(key, group);
      }
      const row = group.row;
      for (const [id, role] of rolePairs) if (id === employeeId && !row.roles.includes(role)) row.roles.push(role);
      const hostName = employees.find(e => e.id === record.hostId)!.name;
      if (!row.hostNames.includes(hostName)) row.hostNames.push(hostName);
      const hours = (range.end - range.start) / 60;
      row.hours += hours; row.spend += record.spend; row.premium += record.revenue;
      row.nightHours += nightHours; row.earlyHours += earlyHours;
      row.nightSpend += record.nightSpend ?? record.spend * (nightHours / hours);
      row.earlySpend += record.earlySpend ?? record.spend * (earlyHours / hours);
      const session = sessionByRecord.get(record.id)!;
      group.sessions.add(session); if (nightHours) group.night.add(session); if (earlyHours) group.early.add(session);
    }
  }
  return deriveLiveMonthly([...groups.values()].map(({row, sessions, night, early}) => ({...row, roles: ['主播', '投手', '场控'].filter(role => row.roles.includes(role)), sessions: sessions.size, nightSessions: night.size, earlySessions: early.size})));
}
