import type { CompensationRule } from './compensation-rules';
import type { Department, Employee } from './domain';
import type { LiveMonthly } from './live-domain';
import type { LiveRoom } from './operations-domain';

/** Fixed, fictional fixture. Expected amounts are independently documented in docs/examples/layered-payroll/. */
export const payrollSettlementExample: {
  month: string;
  employees: Employee[];
  departments: Department[];
  rooms: LiveRoom[];
  rows: LiveMonthly[];
  rules: CompensationRule[];
} = {
  month: '2026-10',
  departments: [{ id: 'example-live', name: '示例直播部', active: true }],
  employees: [
    { id: 'example-lin', name: '林晓', departmentId: 'example-live', position: '主播', joined: '2026-01-01', status: '在职', phone: '', email: '', identities: ['主播'], role: 'employee', nonCompeteSigned: true },
    { id: 'example-zhou', name: '周宁', departmentId: 'example-live', position: '主播', joined: '2026-02-01', status: '在职', phone: '', email: '', identities: ['主播'], role: 'employee', nonCompeteSigned: false },
    { id: 'example-chen', name: '陈雨', departmentId: 'example-live', position: '主播', joined: '2026-03-01', status: '在职', phone: '', email: '', identities: ['主播'], role: 'employee', nonCompeteSigned: true },
    { id: 'example-wu', name: '吴策', departmentId: 'example-live', position: '投手', joined: '2026-02-01', status: '在职', phone: '', email: '', identities: ['投手'], role: 'employee', nonCompeteSigned: false },
  ],
  rooms: [
    { id: 'example-room-a', name: '示例一号房', productId: 'example-product', platformAccountId: 'example-account-a', active: true, openedOn: '2026-01-01' },
    { id: 'example-room-b', name: '示例二号房', productId: 'example-product', platformAccountId: 'example-account-b', active: true, openedOn: '2026-02-01' },
  ],
  rows: [
    {
      employeeId: 'example-lin', employeeName: '林晓', departmentId: 'example-live', departmentName: '示例直播部', employeeJoinedOn: '2026-01-01', nonCompeteSigned: true,
      productId: 'example-product', productName: '示例产品', roomId: 'example-room-a', roomName: '示例一号房', roomOpenedOn: '2026-01-01', year: 2026, month: '2026-10', roles: ['主播'], hostNames: ['林晓'],
      hours: 100, nightHours: 20, earlyHours: 30, regularHours: 50, sessions: 25, nightSessions: 10, earlySessions: 10,
      spend: 10000, nightSpend: 2000, earlySpend: 3000, regularSpend: 5000, premium: 24000, nightPremium: 4000, earlyPremium: 10000, regularPremium: 10000,
      roi: 2.4, hourlySpend: 100, roiRank: 3, spendRank: 1,
    },
    {
      employeeId: 'example-zhou', employeeName: '周宁', departmentId: 'example-live', departmentName: '示例直播部', employeeJoinedOn: '2026-02-01', nonCompeteSigned: false,
      productId: 'example-product', productName: '示例产品', roomId: 'example-room-a', roomName: '示例一号房', roomOpenedOn: '2026-01-01', year: 2026, month: '2026-10', roles: ['主播'], hostNames: ['周宁'],
      hours: 80, nightHours: 20, earlyHours: 10, regularHours: 50, sessions: 20, nightSessions: 5, earlySessions: 2,
      spend: 10000, nightSpend: 2500, earlySpend: 1250, regularSpend: 6250, premium: 30000, nightPremium: 2000, earlyPremium: 4000, regularPremium: 24000,
      roi: 3, hourlySpend: 125, roiRank: 1, spendRank: 1,
    },
    {
      employeeId: 'example-chen', employeeName: '陈雨', departmentId: 'example-live', departmentName: '示例直播部', employeeJoinedOn: '2026-03-01', nonCompeteSigned: true,
      productId: 'example-product', productName: '示例产品', roomId: 'example-room-a', roomName: '示例一号房', roomOpenedOn: '2026-01-01', year: 2026, month: '2026-10', roles: ['主播', '场控'], hostNames: ['陈雨'],
      hours: 60, nightHours: 10, earlyHours: 20, regularHours: 30, sessions: 15, nightSessions: 3, earlySessions: 6,
      spend: 10000, nightSpend: 2000, earlySpend: 3000, regularSpend: 5000, premium: 26000, nightPremium: 2000, earlyPremium: 6000, regularPremium: 18000,
      roi: 2.6, hourlySpend: 166.66666666666666, roiRank: 2, spendRank: 1,
    },
    {
      employeeId: 'example-lin', employeeName: '林晓', departmentId: 'example-live', departmentName: '示例直播部', employeeJoinedOn: '2026-01-01', nonCompeteSigned: true,
      productId: 'example-product', productName: '示例产品', roomId: 'example-room-b', roomName: '示例二号房', roomOpenedOn: '2026-02-01', year: 2026, month: '2026-10', roles: ['主播'], hostNames: ['林晓'],
      hours: 40, nightHours: 5, earlyHours: 5, regularHours: 30, sessions: 10, nightSessions: 2, earlySessions: 1,
      spend: 4000, nightSpend: 500, earlySpend: 500, regularSpend: 3000, premium: 10000, nightPremium: 1000, earlyPremium: 2000, regularPremium: 7000,
      roi: 2.5, hourlySpend: 100, roiRank: 1, spendRank: 1,
    },
    {
      employeeId: 'example-wu', employeeName: '吴策', departmentId: 'example-live', departmentName: '示例直播部', employeeJoinedOn: '2026-02-01', nonCompeteSigned: false,
      productId: 'example-product', productName: '示例产品', roomId: 'example-room-a', roomName: '示例一号房', roomOpenedOn: '2026-01-01', year: 2026, month: '2026-10', roles: ['投手'], hostNames: ['林晓', '周宁', '陈雨'],
      hours: 240, nightHours: 50, earlyHours: 60, regularHours: 130, sessions: 60, nightSessions: 18, earlySessions: 18,
      spend: 30000, nightSpend: 6500, earlySpend: 7250, regularSpend: 16250, premium: 80000, nightPremium: 8000, earlyPremium: 20000, regularPremium: 52000,
      roi: 2.6666666666666665, hourlySpend: 125, roiRank: 1, spendRank: 1,
    },
  ],
  rules: [
    { id: 'g-night-allowance', name: '基础·夜班补贴', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'allowance', allowance: { field: 'nightSessions', amount: 20 } },
    { id: 'g-early-allowance', name: '基础·早班补贴', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'allowance', allowance: { field: 'earlySessions', amount: 10 } },
    { id: 'g-premium', name: '基础·早班系数', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'premium', premium: { normalField: 'regularPremium', earlyField: 'earlyPremium', coefficient: 2, condition: { kind: 'group', operator: 'and', children: [{ kind: 'condition', field: 'monthly.earlySessions', operator: 'gte', value: 5 }] } } },
    { id: 'g-premium-alternative', name: '基础·早班系数备选', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'premium', premium: { normalField: 'regularPremium', earlyField: 'earlyPremium', coefficient: 1.5, condition: { kind: 'group', operator: 'and', children: [{ kind: 'condition', field: 'monthly.earlySessions', operator: 'gte', value: 3 }] } } },
    { id: 'g-floor-total', name: '基础·总时长保底', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'hourly', hourly: { duration: 'hours', items: [{ id: 'gft', name: '总时长保底', kind: 'guarantee', rate: 50 }], formula: { mode: 'guarantee', itemId: 'gft' } } },
    { id: 'g-floor-night', name: '基础·夜班保底', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'hourly', hourly: { duration: 'nightHours', items: [{ id: 'gfn', name: '夜班保底', kind: 'guarantee', rate: 200 }], formula: { mode: 'guarantee', itemId: 'gfn' } } },
    { id: 'g-roi-addition', name: '基础·ROI加成', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'hourly', hourly: { duration: 'hours', items: [{ id: 'gra', name: '有效ROI加成', kind: 'metric', field: 'roi', bands: [{ keyType: 'range', min: 0, max: 3, includeMin: true, includeMax: false, rate: 20 }, { keyType: 'range', min: 3, includeMin: true, includeMax: false, rate: 45 }] }], formula: { mode: 'additions', itemIds: ['gra'] } } },
    { id: 'g-rank-addition', name: '基础·排名加成', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'hourly', hourly: { duration: 'hours', items: [{ id: 'gka', name: '有效ROI排名加成', kind: 'metric', field: 'roiRank', bands: [{ keyType: 'range', min: 1, max: 1, includeMin: true, includeMax: true, rate: 10 }, { keyType: 'range', min: 2, includeMin: true, includeMax: false, rate: 5 }] }], formula: { mode: 'additions', itemIds: ['gka'] } } },
    { id: 'r-regular-addition', name: '双房共用·正常时段加成', version: 1, status: '已发布', scope: 'rooms', roomIds: ['example-room-a', 'example-room-b'], type: 'hourly', hourly: { duration: 'regularHours', items: [{ id: 'rra', name: '正常时段加成', kind: 'special', rate: 20 }], formula: { mode: 'additions', itemIds: ['rra'] } } },
    { id: 'g-extra-night-allowance', name: '全局补充·夜班补贴', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'allowance', allowance: { field: 'nightSessions', amount: 15 } },
    { id: 'g-extra-premium', name: '全局补充·早班系数', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'premium', premium: { normalField: 'regularPremium', earlyField: 'earlyPremium', coefficient: 3, condition: { kind: 'group', operator: 'and', children: [{ kind: 'condition', field: 'monthly.earlySessions', operator: 'gte', value: 5 }] } } },
    { id: 'g-extra-floor-early', name: '全局补充·早班保底', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'hourly', hourly: { duration: 'earlyHours', items: [{ id: 'efe', name: '早班保底', kind: 'guarantee', rate: 220 }], formula: { mode: 'guarantee', itemId: 'efe' } } },
    { id: 'g-extra-floor-total', name: '全局补充·总时长保底', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'hourly', hourly: { duration: 'hours', items: [{ id: 'eft', name: '总时长保底', kind: 'guarantee', rate: 55 }], formula: { mode: 'guarantee', itemId: 'eft' } } },
    { id: 'g-extra-early-addition', name: '全局补充·早班加成', version: 1, status: '已发布', scope: 'global', roomIds: [], type: 'hourly', hourly: { duration: 'earlyHours', items: [{ id: 'eea', name: '早班加成', kind: 'special', rate: 10 }], formula: { mode: 'additions', itemIds: ['eea'] } } },
  ],
};
