import type { Department, Employee, HourlyRule, Project } from './domain';
import type { AdHourly, LiveRecord, RoomHourly } from './live-domain';
import { buildLiveStatistics } from './live-domain';
import { splitLegacyProjects } from './operations-domain';
import type { AdvertisingProduct } from './operations-domain';
import { migrateHourlyRules } from './payroll-rules';

const plain = (value:unknown):Record<string,unknown> => value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const array = <T>(value:unknown):T[] => Array.isArray(value) ? value as T[] : [];
const safeProduct = (product:AdvertisingProduct):AdvertisingProduct => ({
 id:product.id,name:product.name,platform:product.platform,accountId:product.accountId,active:product.active,
 ...(product.access ? {access:{appId:product.access.appId,secretConfigured:!!product.access.secretConfigured,authCodeConfigured:!!product.access.authCodeConfigured}} : {}),
});
/** The persist version invokes this exactly once. Native states also pass through without
 * resetting payroll, so a later rehydration cannot erase newly created tasks or archives. */
export function migrateOperationsState(persisted:unknown):Record<string,unknown> {
 const source=structuredClone(plain(persisted));
 if(Array.isArray(source.products) && Array.isArray(source.rooms)) return source;
 const projects=array<Project>(source.projects),{products:unsafeProducts,rooms}=splitLegacyProjects(projects);
 const products=unsafeProducts.map(safeProduct);
 type LegacyRow = Record<string,unknown> & {projectId?:string};
 const convert = (row:LegacyRow, account=false):Record<string,unknown> => {
  const {projectId,...rest}=row;
  const productId=typeof rest.productId==='string'?rest.productId:`product-${projectId}`;
  const room=account?rooms.find(room=>room.productId===productId && room.platformAccountId===rest.accountId):rooms.find(room=>room.id===projectId);
  // Unrecognized historical account rows are preserved; statistics mark the dataset stale
  // rather than discarding them or pretending they belong to another account.
  return {...rest,productId,roomId:typeof rest.roomId==='string'?rest.roomId:room?.id??projectId};
 };
 const liveRecords=array<LegacyRow>(source.liveRecords).map(row=>convert(row)) as unknown as LiveRecord[];
 const adHours=array<LegacyRow>(source.adHours).map(row=>convert(row)) as unknown as AdHourly[];
 const roomHours=array<LegacyRow>(source.roomHours).map(row=>convert(row,true)) as unknown as RoomHourly[];
 const departmentRules=Array.isArray(source.departmentRules)?array<LegacyRow>(source.departmentRules).map(rule=>{
  const {projectIds,...rest}=rule;
  return {...rest,roomIds:Array.isArray(rest.roomIds)?rest.roomIds:array<string>(projectIds)};
 }):migrateHourlyRules(array<HourlyRule>(source.rules),rooms,products);
 const employees=array<Employee>(source.employees),departments=array<Department>(source.departments);
 const month=typeof source.month==='string'?source.month:'2026-10';
 const revision=(typeof source.revision==='number' && Number.isFinite(source.revision)?source.revision:0)+1;
 const oldDataset=plain(source.dataset),version=typeof oldDataset.version==='number'?oldDataset.version:0;
 let statistics:ReturnType<typeof buildLiveStatistics>={details:[],monthly:[]},published=false;
 try {
  statistics=buildLiveStatistics(liveRecords,roomHours,employees,departments,rooms,products,month);
  published=statistics.monthly.length>0;
 } catch { /* Keep all source rows available for correction and invalidate old derived data. */ }
 const {projects:_projects,rules:_rules,scheme:_scheme,...preserved}=source;
 return {...preserved,products,rooms,liveRecords,adHours,roomHours,departmentRules,month,revision,
  liveDetails:statistics.details,monthlyRows:statistics.monthly,
  dataset:{...oldDataset,rows:statistics.monthly,month,version:version+1,revision:published?revision:-1,published},
  payrollTasks:[],batch:null,batches:{},archivedMonths:[],
 };
}
