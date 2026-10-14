import type { Project, Scheme } from './domain';
import { splitLegacyProjects } from './operations-domain';
import type { AdHourly, LiveRecord, RoomHourly } from './live-domain';
import { seedEmployees, seedProjects, seedRules } from './real-seed';

/** Entirely fictional hourly platform data. Actual September source files remain in real-seed. */
export const demoMonth = '2026-10';
const names = ['平安健康-E生保', '众安-就医无忧保', '众安-尊享E生'];
export const demoProjects: Project[] = names.map((name, i) => ({
  ...seedProjects.find(project => project.name === name)!,
  account: `模拟投放账户-${i + 1}`,
  platform: ['巨量引擎', '磁力引擎', '腾讯 ADQ'][i],
  liveAccountIds: i === 0 ? ['模拟直播账户-1A', '模拟直播账户-1B'] : [`模拟直播账户-${i + 1}A`],
}));
export const {products: demoProducts, rooms: demoRooms} = splitLegacyProjects(demoProjects);
const hosts = seedEmployees.slice(0, 6).map(employee => employee.id);
const buyers = seedEmployees.slice(6, 9).map(employee => employee.id);
const controls = seedEmployees.slice(9, 12).map(employee => employee.id);
const hh = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
export const demoRecords: LiveRecord[] = demoProjects.flatMap((project, i) => ['2026-10-01', '2026-10-02'].flatMap(date => [
  {start: 2, end: 4, hostId: hosts[i * 2]},
  {start: 4, end: 6, hostId: hosts[i * 2]},
  {start: 6, end: 8, hostId: hosts[i * 2]},
  {start: 8, end: 10, hostId: hosts[i * 2 + 1]},
  {start: 15, end: 17, hostId: hosts[i * 2], dualRole: i === 2},
].map((segment, n) => ({id: `demo-${project.id}-${date}-${n}`, roomId: project.id, productId: `product-${project.id}`, date, start: hh(segment.start), end: hh(segment.end), hostId: segment.hostId, buyerId: segment.dualRole ? segment.hostId : buyers[i], controlId: controls[i], version: 1}))));
// Both example days are collected in full: non-broadcast hours are explicit zero measurements,
// never synthesized to fill a missing source record. This demo does not claim full-month coverage.
const isBroadcastHour = (hour: number) => (hour >= 2 && hour < 10) || (hour >= 15 && hour < 17);
const slots = demoRooms.flatMap(room => {
  const project = demoProjects.find(project => `product-${project.id}` === room.productId)!;
  const i = demoProjects.indexOf(project), a = project.liveAccountIds.indexOf(room.platformAccountId);
  return ['2026-10-01', '2026-10-02'].flatMap(date => Array.from({length: 24}, (_, hour) => ({project, room, i, a, date, hour})));
});
export const demoAdHours: AdHourly[] = slots.map(({room, i, date, hour}) => {
  const broadcasting = isBroadcastHour(hour);
  const spend = broadcasting ? 900 + i * 200 + hour * 10 : 0, payment = spend * 1.7, clicks = broadcasting ? 120 + hour : 0, conversions = broadcasting ? 12 + i : 0;
  return {id: `demo-ad-${room.id}-${date}-${hour}`, roomId: room.id, productId: room.productId, date, start: hh(hour), end: hh(hour + 1), spend, payment, impressions: broadcasting ? 10000 + hour * 100 : 0, clicks, conversions, conversionCost: conversions ? spend / conversions : 0, conversionRate: clicks ? conversions / clicks : 0, orders: conversions};
});
export const demoRoomHours: RoomHourly[] = slots.map(({room, i, a, date, hour}) => {
  const accountId = room.platformAccountId;
  const broadcasting = isBroadcastHour(hour);
  const spend = broadcasting ? 1800 + i * 400 + hour * 20 + a * 200 : 0, roi = hour < 8 ? 1.85 + i * .1 : 2.15 + i * .1;
  const revenue = Math.round(spend * roi * 100) / 100, clicks = broadcasting ? 200 + hour * 5 + a * 20 : 0, conversions = broadcasting ? 15 + i + a : 0, viewers = broadcasting ? 1200 + hour * 50 : 0;
  // DEMO only: invented marketing impressions and conversion denominator.
  // These are internal provenance, not a universal platform definition; a real adapter must verify both.
  const clickRateDenominator = broadcasting ? 5000 + hour * 100 : 0, conversionRateDenominator = clicks;
  return {id: `demo-room-${room.id}-${accountId}-${date}-${hour}`, roomId: room.id, productId: room.productId, accountId, date, start: hh(hour), end: hh(hour + 1), spend, revenue, clicks, clickRate: clickRateDenominator ? clicks / clickRateDenominator : 0, clickRateDenominator, clickCost: clicks ? spend / clicks : 0, conversions, conversionRate: conversionRateDenominator ? conversions / conversionRateDenominator : 0, conversionRateDenominator, conversionCost: conversions ? spend / conversions : 0, roi: spend ? revenue / spend : 0, orders: conversions, viewers, fans: broadcasting ? 5 + i + a : 0, tips: 0};
});
export const demoScheme: Scheme = {
  name: '10月模拟直播主播基础时薪方案', version: 1, fixedSalary: 0, departmentIds: ['live'], employeeIds: hosts,
  groups: demoProjects.map((project, i) => ({id: `demo-group-${i + 1}`, name: `${project.name}项目集`, projectIds: [project.id], hourlyRuleId: seedRules[i].id})),
};
