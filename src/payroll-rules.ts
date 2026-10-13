import type { Band, Department, Employee, HourlyRule, Metric, Project, Salary, SalaryComponent, SalaryDetail } from './domain';
import type { LiveMonthly } from './live-domain';

export type PayrollMetric = 'hours' | 'nightHours' | 'earlyHours' | 'spend' | 'premium' | 'roi' | 'hourlySpend' | 'nightSpend' | 'earlySpend' | 'roiRank' | 'sessions' | 'nightSessions' | 'earlySessions';
export type DurationMetric = 'hours' | 'nightHours' | 'earlyHours';
export interface RuleBand extends Band { keyType: 'exact' | 'range' | 'related'; relatedField?: PayrollMetric }
export interface RuleMetric { id: string; field: PayrollMetric; durationField?: DurationMetric; rate?: number; bands: RuleBand[] }
export interface DepartmentRule { id: string; name: string; departmentId: string; version: number; status: '草稿' | '已发布'; metrics: RuleMetric[]; expression: string[]; projectIds: string[]; sourceNote?: string; sourceFloor?: {roiBelow: number; rate: number} }

export const monthlyMetricOptions: {field: PayrollMetric; label: string; kind: '常规指标' | '时长指标'}[] = [
  {field: 'hours', label: '总直播时长', kind: '时长指标'},
  {field: 'nightHours', label: '夜班直播时长', kind: '时长指标'},
  {field: 'earlyHours', label: '早班直播时长', kind: '时长指标'},
  {field: 'spend', label: '总消耗', kind: '常规指标'},
  {field: 'premium', label: '总保费', kind: '常规指标'},
  {field: 'roi', label: 'ROI', kind: '常规指标'},
  {field: 'hourlySpend', label: '时耗', kind: '常规指标'},
  {field: 'nightSpend', label: '夜班消耗', kind: '常规指标'},
  {field: 'earlySpend', label: '早班消耗', kind: '常规指标'},
  {field: 'roiRank', label: 'ROI 排名', kind: '常规指标'},
  {field: 'sessions', label: '直播场次', kind: '常规指标'},
  {field: 'nightSessions', label: '夜班直播场次', kind: '常规指标'},
  {field: 'earlySessions', label: '早班直播场次', kind: '常规指标'},
];
const metricNames = Object.fromEntries(monthlyMetricOptions.map(option => [option.field, option.label])) as Record<PayrollMetric, string>;
const isDuration = (field: PayrollMetric): field is DurationMetric => field === 'hours' || field === 'nightHours' || field === 'earlyHours';
const isMetric = (field: unknown): field is PayrollMetric => typeof field === 'string' && Object.hasOwn(metricNames, field);
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isNonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Source rules remain independent drafts; only the three demo projects are initially bound. */
export function migrateHourlyRules(oldRules: HourlyRule[], projects: Project[]): DepartmentRule[] {
  const projectNames = ['平安健康-E生保', '众安-就医无忧保', '众安-尊享E生'];
  return oldRules.map((old, index) => {
    const metrics: RuleMetric[] = old.measures.map((measure, i) => ({id: `${old.id}-metric-${i + 1}`, field: measure.metric, durationField: 'hours', bands: measure.bands.map(b => ({...b, keyType: b.exact !== undefined ? 'exact' : 'range'}))}));
    const project = index < projectNames.length ? projects.find(p => p.name === projectNames[index]) : undefined;
    return {id: old.id, name: old.name, departmentId: 'live', version: 1, status: '草稿', metrics, expression: metrics.map(metric => metric.id), projectIds: project ? [project.id] : [], sourceNote: old.sourceNote, sourceFloor: old.floor ? {...old.floor} : undefined};
  });
}

function contains(value: number, band: RuleBand): boolean {
  if (band.keyType === 'exact') return value === band.exact;
  return (band.min === undefined || (band.includeMin ? value >= band.min : value > band.min)) && (band.max === undefined || (band.includeMax ? value <= band.max : value < band.max));
}
const matchField = (metric: RuleMetric, band: RuleBand): PayrollMetric => band.keyType === 'related' ? band.relatedField! : metric.field;
function overlaps(a: RuleBand, b: RuleBand): boolean {
  const lo = Math.max(a.keyType === 'exact' ? a.exact! : a.min ?? -Infinity, b.keyType === 'exact' ? b.exact! : b.min ?? -Infinity);
  const hi = Math.min(a.keyType === 'exact' ? a.exact! : a.max ?? Infinity, b.keyType === 'exact' ? b.exact! : b.max ?? Infinity);
  return lo < hi || (lo === hi && contains(lo, a) && contains(lo, b));
}

export function validateDepartmentRule(rule: DepartmentRule): void {
  if (!rule.id?.trim() || !rule.name?.trim()) throw new Error('规则名称和 ID 不能为空');
  if (rule.departmentId !== 'live') throw new Error('仅直播部支持月薪规则，其他部门待开发');
  if (!Number.isInteger(rule.version) || rule.version < 1 || !['草稿', '已发布'].includes(rule.status)) throw new Error('规则版本或状态无效');
  if (!rule.projectIds.length || rule.projectIds.some(id => !id.trim()) || new Set(rule.projectIds).size !== rule.projectIds.length) throw new Error('项目集必须选择有效且不重复的项目');
  if (!rule.metrics.length || rule.metrics.some(metric => !metric.id?.trim() || !isMetric(metric.field))) throw new Error('请选择有效指标');
  if (new Set(rule.metrics.map(metric => metric.id)).size !== rule.metrics.length || new Set(rule.metrics.map(metric => metric.field)).size !== rule.metrics.length) throw new Error('指标 ID 或字段不能重复');
  if (!rule.expression.length || new Set(rule.expression).size !== rule.expression.length || rule.expression.some(id => !rule.metrics.some(metric => metric.id === id))) throw new Error('计算表达式必须引用有效且不重复的指标');
  if (rule.sourceFloor && (!isNonnegative(rule.sourceFloor.roiBelow) || !isNonnegative(rule.sourceFloor.rate))) throw new Error('来源低 ROI 门槛或固定时薪无效');
  for (const metric of rule.metrics) {
    if (isDuration(metric.field)) {
      if (!isNonnegative(metric.rate)) throw new Error('时长指标必须配置有限非负时薪');
      if (metric.bands.length || metric.durationField !== undefined) throw new Error('时长指标直接使用自身时长，不配置档位或关联时长');
      continue;
    }
    if (!metric.durationField || !isDuration(metric.durationField)) throw new Error('常规指标必须选择计薪时长');
    if (!metric.bands.length) throw new Error('时薪枚举不能为空');
    for (const band of metric.bands) {
      if (!['exact', 'range', 'related'].includes(band.keyType) || !isNonnegative(band.rate) || [band.exact, band.min, band.max].some(value => value !== undefined && !Number.isFinite(value))) throw new Error('档位数值或类型无效');
      if (typeof band.includeMin !== 'boolean' || typeof band.includeMax !== 'boolean') throw new Error('档位边界必须指定包含方式');
      if (band.keyType === 'exact') {
        if (band.exact === undefined || band.min !== undefined || band.max !== undefined || band.relatedField !== undefined) throw new Error('精确档位只填写精确值');
      } else {
        if (band.exact !== undefined || (band.min === undefined && band.max === undefined)) throw new Error('范围必须至少有一个边界');
        if (band.min !== undefined && band.max !== undefined && (band.min > band.max || (band.min === band.max && !(band.includeMin && band.includeMax)))) throw new Error('区间范围无效');
        if (band.keyType === 'related' && band.relatedField === metric.field) throw new Error('关联档位必须选择不同于自身的常规指标');
        if (band.keyType === 'related' ? !isMetric(band.relatedField) || isDuration(band.relatedField) : band.relatedField !== undefined) throw new Error('关联档位必须选择常规指标范围');
      }
    }
    for (let i = 0; i < metric.bands.length; i++) for (let j = i + 1; j < metric.bands.length; j++) {
      if (matchField(metric, metric.bands[i]) === matchField(metric, metric.bands[j]) && overlaps(metric.bands[i], metric.bands[j])) throw new Error(`${metricNames[metric.field]} 枚举范围重叠`);
    }
  }
  if (rule.projectIds.length > 1 && rule.expression.some(id => {
    const metric = rule.metrics.find(item => item.id === id)!;
    return metric.field === 'roiRank' || metric.bands.some(band => band.keyType === 'related' && band.relatedField === 'roiRank');
  })) throw new Error('ROI 排名不能跨多个项目汇总，请绑定单个项目');
}

export function calculateDepartmentRules(rows: LiveMonthly[], employees: Employee[], departments: Department[], rules: DepartmentRule[], month: string): Salary[] {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error('核算月份无效');
  rules.forEach(rule => {
    validateDepartmentRule(rule);
    if (!departments.some(department => department.id === rule.departmentId && department.active)) throw new Error('规则部门无效或已停用');
  });
  const salaries: Salary[] = [];
  for (const employee of employees.filter(employee => employee.status === '在职')) {
    const details: SalaryDetail[] = [];
    for (const rule of rules.filter(rule => rule.departmentId === employee.departmentId)) {
      const work = rows.filter(row => row.employeeId === employee.id && row.departmentId === employee.departmentId && row.month === month && rule.projectIds.includes(row.projectId));
      if (!work.length) continue;
      if (new Set(work.map(row => JSON.stringify([row.employeeId, row.projectId, row.month]))).size !== work.length) throw new Error(`${employee.name} 数据集基础粒度重复`);
      const values = new Map<PayrollMetric, number>();
      const input = (field: PayrollMetric): number => {
        const cached = values.get(field);
        if (cached !== undefined) return cached;
        let value: number;
        if (field === 'roi' || field === 'hourlySpend') {
          const denominator = input(field === 'roi' ? 'spend' : 'hours');
          if (denominator <= 0) throw new Error(field === 'roi' ? `${employee.name} 消耗为零，无法计算 ROI` : `${employee.name} 直播时长为零，无法计算时耗`);
          value = input(field === 'roi' ? 'premium' : 'spend') / denominator;
        } else {
          if (work.some(row => !isNonnegative(row[field]))) throw new Error(`${employee.name} ${metricNames[field]} 数据缺失或无效`);
          value = field === 'roiRank' ? work[0][field] : work.reduce((sum, row) => sum + row[field], 0);
        }
        if (!isNonnegative(value)) throw new Error(`${employee.name} ${metricNames[field]} 汇总数据无效`);
        values.set(field, value);
        return value;
      };
      const hours = input('hours'), spend = input('spend'), premium = input('premium');
      const roi = spend > 0 ? input('roi') : 0, hourlySpend = hours > 0 ? input('hourlySpend') : 0;
      const components: SalaryComponent[] = [];
      const component = (metricId: string, field: PayrollMetric, matchedField: PayrollMetric, matchedValue: number, rate: number, durationField: DurationMetric, duration: number): SalaryComponent => {
        const amount = money(rate * duration);
        if (!isNonnegative(amount)) throw new Error(`${employee.name} 薪资金额无效`);
        return {metricId, field, fieldName: metricNames[field], matchField: matchedField, matchValue: matchedValue, rate, durationField, durationName: metricNames[durationField], hours: duration, amount};
      };
      if (rule.sourceFloor && hours > 0 && input('roi') < rule.sourceFloor.roiBelow) {
        components.push(component(`${rule.id}-source-floor`, 'roi', 'roi', roi, rule.sourceFloor.rate, 'hours', hours));
      } else for (const id of rule.expression) {
        const metric = rule.metrics.find(metric => metric.id === id)!;
        const durationField = isDuration(metric.field) ? metric.field : metric.durationField!;
        const duration = input(durationField);
        if (duration === 0) {
          components.push(component(metric.id, metric.field, metric.field, 0, isDuration(metric.field) ? metric.rate! : 0, durationField, 0));
          continue;
        }
        if (isDuration(metric.field)) {
          components.push(component(metric.id, metric.field, metric.field, duration, metric.rate!, durationField, duration));
          continue;
        }
        const matched = metric.bands.filter(band => contains(input(matchField(metric, band)), band));
        if (!matched.length) throw new Error(`${employee.name} ${metricNames[metric.field]} 未命中时薪区间`);
        if (matched.length > 1) throw new Error(`${employee.name} ${metricNames[metric.field]} 时薪区间多次命中，无法唯一匹配`);
        const field = matchField(metric, matched[0]);
        components.push(component(metric.id, metric.field, field, input(field), matched[0].rate, durationField, duration));
      }
      const rate = components.reduce((sum, item) => sum + item.rate, 0), commission = money(components.reduce((sum, item) => sum + item.amount, 0));
      if (!isNonnegative(rate) || !isNonnegative(commission)) throw new Error(`${employee.name} 薪资汇总无效`);
      // The legacy match list only represents its original three metric types; components are authoritative.
      const matches = components.filter(item => ['roi', 'hourlySpend', 'spend'].includes(item.matchField)).map(item => ({metric: item.matchField as Metric, input: item.matchValue, rate: item.rate}));
      details.push({groupId: rule.id, groupName: rule.name, projectIds: work.map(row => row.projectId), hours, spend, premium, roi, hourlySpend, rate, commission, matches, ruleName: rule.name, ruleVersion: rule.version, components});
    }
    if (!details.length) continue;
    const commission = money(details.reduce((sum, detail) => sum + detail.commission, 0));
    if (!isNonnegative(commission)) throw new Error(`${employee.name} 薪资汇总无效`);
    salaries.push({employeeId: employee.id, employeeName: employee.name, departmentName: departments.find(department => department.id === employee.departmentId)!.name, fixed: 0, commission, total: commission, details});
  }
  return salaries;
}
