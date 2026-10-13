import type { Department, Employee, Project, WorkRow } from './domain';

export interface LiveRecord { id: string; projectId: string; date: string; start: string; end: string; hostId: string; buyerId: string; controlId: string; version: number }
export interface AdHourly { id: string; projectId: string; date: string; start: string; end: string; spend: number; payment: number; impressions: number; clicks: number; conversions: number; conversionCost: number; conversionRate: number; orders: number }
export interface RoomHourly { clickRateDenominator?: number; conversionRateDenominator?: number; id: string; projectId: string; accountId: string; date: string; start: string; end: string; spend: number; revenue: number; clicks: number; clickRate: number; clickCost: number; conversions: number; conversionRate: number; conversionCost: number; roi: number; orders: number; viewers: number; fans: number; tips: number }
export interface LiveDetail extends LiveRecord { projectCode: string; projectName: string; hostName: string; buyerName: string; controlName: string; spend: number; revenue: number; clicks: number; clickRate: number | null; clickCost: number | null; conversions: number; conversionRate: number | null; conversionCost: number | null; roi: number; orders: number; viewers: number; fans: number; tips: number }
export interface LiveMonthly extends WorkRow { roles: string[]; hostNames: string[]; year: number; nightHours: number; earlyHours: number; nightSpend: number; earlySpend: number; roiRank: number; sessions: number; nightSessions: number; earlySessions: number }
export type LiveTemplateRow = Pick<LiveRecord, 'projectId' | 'date' | 'start' | 'end'>;

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
export function generateLiveTemplate(projectIds: string[], date: string, start: string, end: string, stepMinutes: number): LiveTemplateRow[] {
  const range = interval({date, start, end});
  if (!projectIds.length || projectIds.some(id => !id.trim())) throw new Error('请选择有效项目');
  if (new Set(projectIds).size !== projectIds.length) throw new Error('项目不能重复');
  if (!Number.isInteger(stepMinutes) || stepMinutes <= 0 || stepMinutes % 60) throw new Error('模板分片必须为正整小时倍数');
  return projectIds.flatMap(projectId => Array.from({length: Math.ceil((range.end - range.start) / stepMinutes)}, (_, i) => ({projectId, date, start: hourText(range.start + i * stepMinutes), end: hourText(Math.min(range.end, range.start + (i + 1) * stepMinutes))})));
}
export function validateLiveRecord(record: LiveRecord, employees: Employee[], projects: Project[], existing: LiveRecord[], archivedMonths: string[]): void {
  const range = interval(record);
  if (!record.id?.trim() || !Number.isInteger(record.version) || record.version < 1) throw new Error('直播记录 ID 或版本无效');
  if (!projects.some(p => p.id === record.projectId)) throw new Error('直播记录项目无效');
  if ([record.hostId, record.buyerId, record.controlId].some(id => !employees.some(e => e.id === id))) throw new Error('直播记录岗位员工 ID 无效');
  const replaced = existing.find(r => r.id === record.id);
  if (archivedMonths.includes(record.date.slice(0, 7)) || (replaced && archivedMonths.includes(replaced.date.slice(0, 7)))) throw new Error('归档月份直播记录只读，不能新增、修改或移出');
  for (const other of existing) {
    if (other.id === record.id || other.projectId !== record.projectId) continue;
    const otherRange = interval(other);
    if (range.absoluteStart < otherRange.absoluteEnd && range.absoluteEnd > otherRange.absoluteStart) throw new Error('同项目直播记录时间重叠');
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
  return {...totals, clickRate: rate('clickRate', 'clickRateDenominator', totals.clicks), clickCost: totals.clicks ? totals.spend / totals.clicks : null, conversionRate: rate('conversionRate', 'conversionRateDenominator', totals.conversions), conversionCost: totals.conversions ? totals.spend / totals.conversions : null, roi: totals.spend ? totals.revenue / totals.spend : 0};
}
/** Rates are ratios (0.1 = 10%). Multi-source rates require explicit, adapter-verified denominators;
 * viewer counts are never assumed to be marketing exposures. Undefined rates and costs are null. */
export function buildLiveStatistics(records: LiveRecord[], rooms: RoomHourly[], employees: Employee[], departments: Department[], projects: Project[], month: string): {details: LiveDetail[]; monthly: LiveMonthly[]} {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('统计月份无效');
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('直播记录 ID 重复');
  if (new Set(employees.map(e => e.id)).size !== employees.length || new Set(projects.map(p => p.id)).size !== projects.length) throw new Error('员工或项目 ID 重复');
  records.forEach(record => validateLiveRecord(record, employees, projects, records, []));
  const selected = records.filter(r => r.date.slice(0, 7) === month);
  const selectedProjects = new Set(selected.map(r => r.projectId));
  const sourceIndex = new Map<string, RoomHourly>();
  const sourceIds = new Set<string>();
  for (const source of rooms.filter(r => r.date.slice(0, 7) === month && selectedProjects.has(r.projectId))) {
    const range = interval(source);
    if (range.end - range.start !== 60) throw new Error('直播间来源必须为完整一个小时');
    const project = projects.find(p => p.id === source.projectId)!;
    if (!project.liveAccountIds.includes(source.accountId)) throw new Error('直播间来源账户不属于项目绑定账户');
    if (numericFields.some(field => !Number.isFinite(source[field]) || source[field] < 0) || [source.clickRateDenominator, source.conversionRateDenominator].some(value => value !== undefined && (!Number.isFinite(value) || value < 0))) throw new Error('直播间来源存在无效数值');
    const key = JSON.stringify([source.projectId, source.accountId, source.date, source.start]);
    if (sourceIndex.has(key) || sourceIds.has(source.id)) throw new Error('直播间来源小时或 ID 重复');
    sourceIds.add(source.id); sourceIndex.set(key, source);
  }
  // A session identity is the first record start for a continuous project + three-role combination.
  const sessionByRecord = new Map<string, string>();
  const previousByProject = new Map<string, {record: LiveRecord; session: string}>();
  for (const record of [...records].sort((a, b) => interval(a).absoluteStart - interval(b).absoluteStart || a.id.localeCompare(b.id))) {
    const previous = previousByProject.get(record.projectId);
    const sameTeam = previous && previous.record.hostId === record.hostId && previous.record.buyerId === record.buyerId && previous.record.controlId === record.controlId;
    const continuous = sameTeam && interval(previous.record).absoluteEnd === interval(record).absoluteStart;
    const session = continuous ? previous.session : JSON.stringify([record.projectId, record.hostId, record.buyerId, record.controlId, interval(record).absoluteStart]);
    sessionByRecord.set(record.id, session); previousByProject.set(record.projectId, {record, session});
  }
  type Group = {row: LiveMonthly; sessions: Set<string>; night: Set<string>; early: Set<string>};
  const groups = new Map<string, Group>();
  const details: LiveDetail[] = [];
  for (const record of selected) {
    const project = projects.find(p => p.id === record.projectId)!;
    if (!project.liveAccountIds.length || new Set(project.liveAccountIds).size !== project.liveAccountIds.length) throw new Error('项目需绑定有效且不重复的直播账户');
    const range = interval(record), source: RoomHourly[] = [], night: RoomHourly[] = [], early: RoomHourly[] = [];
    for (let minute = range.start; minute < range.end; minute += 60) for (const accountId of project.liveAccountIds) {
      const hour = sourceIndex.get(JSON.stringify([project.id, accountId, record.date, hourText(minute)]));
      if (!hour) throw new Error(`${project.name} ${record.date} ${hourText(minute)} 账户 ${accountId} 缺少直播间小时来源`);
      source.push(hour); if (minute >= 120 && minute < 360) night.push(hour); if (minute >= 360 && minute < 480) early.push(hour);
    }
    const sums = aggregate(source);
    if (sums.spend <= 0) throw new Error('直播记录消耗为零，无法计算 ROI');
    details.push({...record, projectCode: project.code, projectName: project.name, hostName: employees.find(e => e.id === record.hostId)!.name, buyerName: employees.find(e => e.id === record.buyerId)!.name, controlName: employees.find(e => e.id === record.controlId)!.name, ...sums});
    const rolePairs = [[record.hostId, '主播'], [record.buyerId, '投手'], [record.controlId, '场控']] as const;
    for (const employeeId of new Set(rolePairs.map(([id]) => id))) {
      const key = JSON.stringify([employeeId, project.id, month]), employee = employees.find(e => e.id === employeeId)!;
      let group = groups.get(key);
      if (!group) {
        const department = departments.find(d => d.id === employee.departmentId);
        if (!department) throw new Error(`${employee.name} 部门归属无效`);
        group = {row: {employeeId, employeeName: employee.name, departmentId: department.id, departmentName: department.name, projectId: project.id, month, year: Number(month.slice(0, 4)), roles: [], hostNames: [], hours: 0, spend: 0, premium: 0, roi: 0, hourlySpend: 0, nightHours: 0, earlyHours: 0, nightSpend: 0, earlySpend: 0, sessions: 0, nightSessions: 0, earlySessions: 0, roiRank: 0}, sessions: new Set(), night: new Set(), early: new Set()};
        groups.set(key, group);
      }
      const row = group.row;
      for (const [id, role] of rolePairs) if (id === employeeId && !row.roles.includes(role)) row.roles.push(role);
      const hostName = employees.find(e => e.id === record.hostId)!.name;
      if (!row.hostNames.includes(hostName)) row.hostNames.push(hostName);
      row.hours += (range.end - range.start) / 60; row.spend += sums.spend; row.premium += sums.revenue;
      row.nightHours += night.length / project.liveAccountIds.length; row.earlyHours += early.length / project.liveAccountIds.length;
      row.nightSpend += aggregate(night).spend; row.earlySpend += aggregate(early).spend;
      const session = sessionByRecord.get(record.id)!;
      group.sessions.add(session); if (night.length) group.night.add(session); if (early.length) group.early.add(session);
    }
  }
  const monthly = [...groups.values()].map(({row, sessions, night, early}) => ({...row, roles: ['主播', '投手', '场控'].filter(role => row.roles.includes(role)), roi: row.premium / row.spend, hourlySpend: row.spend / row.hours, sessions: sessions.size, nightSessions: night.size, earlySessions: early.size}));
  for (const row of monthly) row.roiRank = 1 + monthly.filter(other => other.projectId === row.projectId && other.roi > row.roi).length;
  return {details, monthly};
}
