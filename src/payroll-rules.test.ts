import { splitLegacyProjects } from './operations-domain';
import { describe, expect, it } from 'vitest';
import type { Employee } from './domain';
import type { LiveMonthly } from './live-domain';
import { demoProducts, demoRooms } from './live-seed';
import { seedDepartments, seedRules, seedProjects } from './seed';
import { calculateDepartmentRules, migrateHourlyRules, monthlyMetricOptions, validateDepartmentRule, type DepartmentRule, type RuleBand } from './payroll-rules';

const employee: Employee = { id: 'e1', name: '甲', departmentId: 'live', position: '主播', joined: '', status: '在职', phone: '', email: '', identities: [], role: '', fixedSalary: 9999 };
const row = (values: Partial<LiveMonthly> = {}): LiveMonthly => ({employeeId: 'e1', employeeName: '甲', departmentId: 'live', departmentName: '直播部', roomId: 'p1', roomName:'直播间一', productId:'product-p1',productName:'产品一', month: '2026-10', year: 2026, roles: ['主播'], hostNames: ['甲'], hours: 10, nightHours: 2, earlyHours: 3, spend: 100, premium: 200, roi: 999, hourlySpend: 999, nightSpend: 20, earlySpend: 30, sessions: 2, nightSessions: 1, earlySessions: 1, roiRank: 1, ...values});
const band = (values: Partial<RuleBand> = {}): RuleBand => ({keyType: 'range', min: 0, includeMin: true, includeMax: false, rate: 10, ...values});
const rule = (values: Partial<DepartmentRule> = {}): DepartmentRule => ({id: 'r1', name: '规则', departmentId: 'live', version: 1, status: '草稿', metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands: [band()]}], expression: ['m1'], roomIds: ['p1'], ...values});
const calculate = (rules: DepartmentRule[], rows = [row()], employees = [employee]) => calculateDepartmentRules(rows, employees, seedDepartments, rules, '2026-10');

describe('department payroll rules', () => {
  it('publishes the fixed 13 monthly metrics and migrates all legacy bands and floor independently', () => {
    expect(monthlyMetricOptions).toHaveLength(13);
    expect(monthlyMetricOptions.filter(m => m.kind === '时长指标').map(m => m.field)).toEqual(['hours', 'nightHours', 'earlyHours']);
    const migrated = migrateHourlyRules(seedRules, demoRooms, demoProducts);
    expect(migrated).toHaveLength(6);
    expect(migrated.slice(0, 3).map(r => r.roomIds)).toEqual(demoRooms.filter(r=>!r.id.includes('-room-')).map(p => [p.id]));
    expect(migrated[3].roomIds).toEqual([]);
    const nativeSources = splitLegacyProjects(seedProjects);
    const allMigrated = migrateHourlyRules(seedRules, nativeSources.rooms, nativeSources.products);
    expect(allMigrated.every(rule => rule.roomIds.length === 1)).toBe(true);
    expect(allMigrated.map(rule => nativeSources.rooms.find(room => room.id === rule.roomIds[0])?.name)).toEqual(['平安健康-E生保直播间','众安-就医无忧保直播间','众安-尊享E生直播间','众安-众民保百万医疗直播间','太平洋-长期医疗免健告版直播间','平安财-总部普惠保直播间']);
    expect(migrated.every(r => r.departmentId === 'live' && r.status === '草稿' && r.version === 1)).toBe(true);
    expect(migrated[0].metrics[0].bands.map(({keyType: _, ...b}) => b)).toEqual(seedRules[0].measures[0].bands);
    expect(migrated.map(r => r.sourceFloor)).toEqual(seedRules.map(r => r.floor));
    migrated[0].metrics[0].bands[0].rate = 999;
    expect(seedRules[0].measures[0].bands[0].rate).not.toBe(999);
  });
  it('matches open bounds, exact keys, and adjacent closed/open boundaries accurately', () => {
    const bands = [band({min: undefined, max: 2, rate: 3}), band({min: 2, max: 3, rate: 4}), band({keyType: 'exact', min: undefined, exact: 3, rate: 5}), band({min: 3, includeMin: false, rate: 6})];
    for (const [roi, rate] of [[1, 3], [2, 4], [3, 5], [4, 6]]) {
      expect(calculate([rule({metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands}]})], [row({premium: roi * 100})])[0].commission).toBe(rate * 10);
    }
  });
  it('adds each expression metric rate times its own duration', () => {
    const configured = rule({metrics: [{id: 'm1', field: 'roi', durationField: 'nightHours', bands: [band({rate: 20})]}, {id: 'm2', field: 'earlyHours', rate: 30, bands: []}], expression: ['m1', 'm2']});
    const salary = calculate([configured])[0];
    expect(salary).toMatchObject({fixed: 0, commission: 130, total: 130});
    expect(salary.details[0]).toMatchObject({roomIds:['p1'],productIds:['product-p1']});
    expect(salary.details[0].components).toMatchObject([{metricId: 'm1', hours: 2, amount: 40, matchField: 'roi', matchValue: 2}, {metricId: 'm2', hours: 3, amount: 90}]);
  });
  it('matches related bands against their associated normal metric rather than the own metric', () => {
    const configured = rule({metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands: [band({keyType: 'related', relatedField: 'spend', min: 90, max: 110, rate: 8})]}]});
    expect(calculate([configured])[0].details[0].components?.[0]).toMatchObject({matchField: 'spend', matchValue: 100, amount: 80});
  });
  it('recomputes ratios over project sums and adds sessions', () => {
    const configured = rule({roomIds: ['p1', 'p2'], metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands: [band({min: 2.7, max: 2.8, rate: 5})]}, {id: 'm2', field: 'hourlySpend', durationField: 'hours', bands: [band({min: 20, max: 21, rate: 2})]}, {id: 'm3', field: 'sessions', durationField: 'hours', bands: [band({keyType: 'exact', min: undefined, exact: 5, rate: 1})]}], expression: ['m1', 'm2', 'm3']});
    const salary = calculate([configured], [row(), row({roomId: 'p2', hours: 10, spend: 300, premium: 900, sessions: 3})])[0];
    expect(salary.total).toBe(160);
    expect(salary.details[0]).toMatchObject({roi: 2.75, hourlySpend: 20, hours: 20});
  });
  it('only includes participating in-service employees in the selected department, month and projects', () => {
    const rows = [row(), row({employeeId: 'off'}), row({employeeId: 'ad', departmentId: 'ads'}), row({month: '2026-09'}), row({roomId: 'unbound'})];
    const employees = [employee, {...employee, id: 'off', status: '已离职' as const}, {...employee, id: 'ad', departmentId: 'ads'}, {...employee, id: 'idle'}];
    expect(calculate([rule()], rows, employees).map(s => s.employeeId)).toEqual(['e1']);
  });
  it('preserves legacy low ROI override using total hours before expression matching', () => {
    const configured = rule({sourceFloor: {roiBelow: 1.5, rate: 7}, metrics: [{id: 'm1', field: 'roi', durationField: 'nightHours', bands: [band({min: 2})]}]});
    expect(calculate([configured], [row({premium: 100})])[0].total).toBe(70);
    expect(() => calculate([configured], [row({premium: 150})])).toThrow(/未命中/);
  });
  it('skips matching when the selected duration is zero', () => {
    const configured = rule({metrics: [{id: 'm1', field: 'roi', durationField: 'nightHours', bands: [band({min: 10})]}]});
    expect(calculate([configured], [row({nightHours: 0})])[0].total).toBe(0);
  });
  it('rejects roiRank across multiple bound projects even if this employee has one', () => {
    const configured = rule({roomIds: ['p1', 'p2'], metrics: [{id: 'm1', field: 'roiRank', durationField: 'hours', bands: [band()]}]});
    expect(() => calculate([configured])).toThrow(/排名.*多.*直播间|多.*直播间.*排名/);
    expect(() => calculate([rule({roomIds: ['p1', 'p2'], metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands: [band({keyType: 'related', relatedField: 'roiRank'})]}]})])).toThrow(/排名.*多.*直播间|多.*直播间.*排名/);
  });
  it('rejects structural overlaps on the same matching field, but defers cross-field ambiguity until calculation', () => {
    expect(() => validateDepartmentRule(rule({metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands: [band(), band({min: 1})]}]}))).toThrow(/重叠/);
    const mixed = rule({metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands: [band(), band({keyType: 'related', relatedField: 'spend'})]}]});
    expect(() => validateDepartmentRule(mixed)).not.toThrow();
    expect(() => calculate([mixed])).toThrow(/多.*命中|重叠|唯一/);
  });
  it('requires related bands to use a different normal metric', () => {
    expect(() => validateDepartmentRule(rule({metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands: [band({keyType: 'related', relatedField: 'roi'})]}]}))).toThrow(/不同|自身/);
  });
  it('adds separate rules even when they bind the same project', () => {
    expect(calculate([rule(), rule({id: 'r2'})])[0]).toMatchObject({total: 200, commission: 200, fixed: 0});
  });
  it('rejects duplicate grains, missing values, and nonfinite relevant inputs', () => {
    expect(() => calculate([rule()], [row(), row()])).toThrow(/粒度重复/);
    expect(() => calculate([rule()], [row({premium: NaN})])).toThrow(/无效|缺失/);
    expect(() => calculate([rule()], [row({hours: undefined as unknown as number})])).toThrow(/无效|缺失/);
    expect(() => calculate([rule()], [row({spend: 0})])).toThrow(/ROI|消耗/);
  });
  it('validates identity, expression references, field types, and finite ranges and rates', () => {
    for (const invalid of [rule({name: ' '}), rule({departmentId: 'ads'}), rule({roomIds: []}), rule({expression: ['m1', 'm1']}), rule({expression: ['missing']}), rule({metrics: [{id: 'm1', field: 'roi', bands: [band()]}]}), rule({metrics: [{id: 'm1', field: 'hours', rate: -1, bands: []}]}), rule({metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands: [band({min: undefined})]}]}), rule({metrics: [{id: 'm1', field: 'roi', durationField: 'hours', bands: [band({keyType: 'related', relatedField: 'hours'})]}]})]) {
      expect(() => validateDepartmentRule(invalid)).toThrow();
    }
  });
});
