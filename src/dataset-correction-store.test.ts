import { afterEach, beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import type { LiveRecord, RoomHourly, LiveMonthly } from './live-domain';
const archiveCurrentMonth = () => { useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});const s=useHub.getState();s.archivePayroll(s.month,s.batch!.review!.version); };

const record:LiveRecord={id:'record',roomId:'room',productId:'product',date:'2026-10-01',start:'02:00',end:'03:00',hostId:'host',buyerId:'buyer',controlId:'control',version:1};
const hourly:RoomHourly={id:'hour',roomId:'room',productId:'product',accountId:'account',date:record.date,start:record.start,end:record.end,spend:100,revenue:200,clicks:20,clickRate:0.2,clickCost:5,conversions:10,conversionRate:0.5,conversionCost:10,roi:2,orders:10,viewers:100,fans:5,tips:0};
const key=(row:LiveMonthly)=>JSON.stringify([row.employeeId,row.roomId,row.month]);
const hostRow=()=>useHub.getState().monthlyRows.find(r=>r.employeeId==='host')!;
const saveDetail=(patch:Record<string,unknown>,reason='核对来源')=>useHub.getState().saveDatasetCorrection('details','record',patch,reason,useHub.getState().dataset.version);
const saveMonthly=(patch:Record<string,unknown>,reason='核对月度')=>useHub.getState().saveDatasetCorrection('monthly',key(hostRow()),patch,reason,useHub.getState().dataset.version);
const originalStorage=useHub.persist.getOptions().storage;
afterEach(()=>useHub.persist.setOptions({storage:originalStorage}));
beforeEach(()=>{
 useHub.getState().reset();
 useHub.setState({session:{kind:'admin',username:'operator',method:'password'},month:'2026-10',employees:['host','buyer','control','replacement'].map(id=>({id,name:id,departmentId:'live',position:'主播',joined:'2026-01-01',status:'在职',phone:'',email:'',identities:[],role:'员工'})),departments:[{id:'live',name:'直播部',active:true},{id:'ads',name:'投放部',active:true}],products:[{id:'product',name:'产品',accountId:'ad-account',platform:'巨量引擎',active:true}],rooms:[{id:'room',name:'直播间',platformAccountId:'account',productId:'product',active:true},{id:'other',name:'另一直播间',platformAccountId:'other-account',productId:'product',active:true}],liveRecords:[record],adHours:[],roomHours:[hourly],archivedMonths:[],revision:1,batch:null,batches:{},departmentRules:[{id:'rule',name:'时薪',departmentId:'live',version:1,status:'草稿',roomIds:['room','other'],expression:['hours'],metrics:[{id:'hours',field:'hours',rate:50,bands:[]}]}],payrollTasks:[]});
 useHub.getState().cleanDataset();
});

it('明细修订重建月度并记录完整审计，原始来源和来源版本不变',()=>{
 const before=structuredClone(useHub.getState().liveDetails[0]),version=useHub.getState().dataset.version;
 saveDetail({spend:200,revenue:600},'  对账修正  ');
 const s=useHub.getState();
 expect(s.liveDetails[0]).toMatchObject({spend:200,revenue:600,roi:3});
 expect(hostRow()).toMatchObject({spend:200,premium:600,roi:3,hourlySpend:200});
 expect(s.liveRecords).toEqual([record]);expect(s.roomHours).toEqual([hourly]);expect(s.revision).toBe(1);
 expect(s.dataset).toMatchObject({version:version+1,revision:1,published:true});
 expect(s.correctionAudit[0]).toMatchObject({table:'details',key:'record',sourceMonth:'2026-10',targetMonth:'2026-10',reason:'对账修正',operator:'operator',action:'修改',before,after:s.liveDetails[0]});
 expect(s.correctionAudit[0].at).toMatch(/^\d{4}-\d{2}-\d{2} /);
});

it('修订原因必填、派生指标只读、旧版本和未刷新来源均原子拒绝',()=>{
 const before=structuredClone(useHub.getState().monthlyRows),version=useHub.getState().dataset.version;
 expect(()=>saveDetail({spend:200},' ')).toThrow('原因');
 expect(()=>saveMonthly({roi:10})).toThrow();
 saveDetail({spend:200});
 expect(()=>useHub.getState().saveDatasetCorrection('details','record',{spend:300},'旧编辑',version)).toThrow('版本');
 useHub.setState({revision:2});
 expect(()=>saveDetail({spend:400})).toThrow('重新');
 expect(useHub.getState().correctionAudit).toHaveLength(1);expect(useHub.getState().liveDetails[0].spend).toBe(200);expect(before[0].spend).toBe(100);
});

it('没有实际改动的明细和月度保存不产生覆盖、审计或版本',()=>{
 const version=useHub.getState().dataset.version;
 expect(()=>saveDetail({})).toThrow('没有修改');
 expect(()=>saveDetail({spend:100})).toThrow('没有修改');
 expect(()=>saveMonthly({spend:100,hostNames:[...hostRow().hostNames]})).toThrow('没有修改');
 expect(useHub.getState().detailOverrides).toEqual([]);expect(useHub.getState().monthlyOverrides).toEqual([]);expect(useHub.getState().correctionAudit).toEqual([]);expect(useHub.getState().dataset.version).toBe(version);
 saveDetail({spend:200});const updated=useHub.getState().dataset.version;
 expect(()=>saveDetail({spend:200})).toThrow('没有修改');
 expect(useHub.getState().dataset.version).toBe(updated);expect(useHub.getState().correctionAudit).toHaveLength(1);
});

it('明细跨月移动、切月和刷新只在有效月份统计一次，恢复回到原月份',()=>{
 saveDetail({date:'2026-11-01',hostId:'replacement',roomId:'other'});
 expect(useHub.getState().liveDetails).toEqual([]);expect(useHub.getState().monthlyRows).toEqual([]);
 useHub.getState().setMonth('2026-11');
 expect(useHub.getState().liveDetails[0]).toMatchObject({date:'2026-11-01',hostId:'replacement',roomId:'other'});
 expect(useHub.getState().monthlyRows.map(r=>r.employeeId).sort()).toEqual(['buyer','control','replacement']);
 useHub.getState().cleanDataset();
 expect(useHub.getState().monthlyRows).toHaveLength(3);
 useHub.getState().restoreDatasetCorrection('details','record','恢复来源',useHub.getState().dataset.version);
 expect(useHub.getState().liveDetails).toEqual([]);expect(useHub.getState().detailOverrides).toEqual([]);
 expect(useHub.getState().correctionAudit.at(-1)).toMatchObject({action:'恢复自动',after:null});
 useHub.getState().setMonth('2026-10');expect(hostRow()).toMatchObject({spend:100});expect(useHub.getState().correctionAudit).toHaveLength(2);
});

it('月度跨月再次修改按展示键定位原覆盖，恢复原月份统计',()=>{
 saveMonthly({month:'2026-11',spend:250,premium:750});
 expect(useHub.getState().monthlyRows.some(r=>r.employeeId==='host')).toBe(false);
 useHub.getState().setMonth('2026-11');expect(hostRow()).toMatchObject({spend:250,roi:3});
 saveMonthly({roomId:'other',spend:300});
 expect(useHub.getState().monthlyOverrides).toHaveLength(1);
 expect(useHub.getState().monthlyOverrides[0]).toMatchObject({key:'["host","room","2026-10"]',sourceMonth:'2026-10',row:{roomId:'other',month:'2026-11',spend:300}});
 useHub.getState().cleanDataset();expect(hostRow().spend).toBe(300);
 useHub.getState().restoreDatasetCorrection('monthly',key(hostRow()),'取消迁移',useHub.getState().dataset.version);
 expect(useHub.getState().monthlyRows).toEqual([]);
 useHub.getState().setMonth('2026-10');expect(hostRow()).toMatchObject({spend:100,roomId:'room'});
});

it('修订和恢复保护原始、当前及目标归档月份，拒绝不改历史',()=>{
 useHub.setState({archivedMonths:['2026-11']});expect(()=>saveDetail({date:'2026-11-01'})).toThrow('归档');
 expect(()=>saveMonthly({month:'2026-11'})).toThrow('归档');
 useHub.setState({archivedMonths:[]});saveMonthly({month:'2026-11'});useHub.getState().setMonth('2026-11');
 const before=structuredClone(useHub.getState().monthlyOverrides),version=useHub.getState().dataset.version;
 useHub.setState({archivedMonths:['2026-10']});
 expect(()=>saveMonthly({spend:200})).toThrow('归档');
 expect(()=>useHub.getState().restoreDatasetCorrection('monthly',key(hostRow()),'恢复',version)).toThrow('归档');
 expect(useHub.getState().monthlyOverrides).toEqual(before);expect(useHub.getState().dataset.version).toBe(version);
 useHub.setState({archivedMonths:['2026-11']});expect(()=>saveMonthly({spend:200})).toThrow('归档');
});

it('月度跨月碰撞及目标已有记录缺小时来源整笔拒绝，不写覆盖或审计',()=>{
 useHub.setState({liveRecords:[record,{...record,id:'nov',date:'2026-11-01'}],roomHours:[hourly,{...hourly,id:'nov-hour',date:'2026-11-01'}]});useHub.getState().cleanDataset();
 const version=useHub.getState().dataset.version;
 expect(()=>saveMonthly({month:'2026-11'})).toThrow();
 expect(useHub.getState().monthlyOverrides).toEqual([]);expect(useHub.getState().correctionAudit).toEqual([]);expect(useHub.getState().dataset.version).toBe(version);
 useHub.setState({roomHours:[hourly]});
 expect(()=>saveDetail({date:'2026-11-02'})).toThrow('缺少');
 expect(useHub.getState().detailOverrides).toEqual([]);expect(useHub.getState().correctionAudit).toEqual([]);
});

it('刷新、持久化重载保存覆盖和历史，持久化版本保持兼容',async()=>{
 saveDetail({spend:200});saveMonthly({spend:350,premium:700,waitingSalaryDays:12,past3MonthsAvgHourlyRate:62.75});
 useHub.getState().cleanDataset();expect(hostRow()).toMatchObject({spend:350,roi:2,waitingSalaryDays:12,past3MonthsAvgHourlyRate:62.75});
 const saved=structuredClone(useHub.persist.getOptions().partialize!(useHub.getState()));
 useHub.persist.setOptions({storage:{getItem:()=>({state:saved,version:1}),setItem:()=>{},removeItem:()=>{}}});
 useHub.getState().reset();await useHub.persist.rehydrate();useHub.getState().cleanDataset();
 expect(hostRow()).toMatchObject({spend:350,roi:2,waitingSalaryDays:12,past3MonthsAvgHourlyRate:62.75});expect(useHub.getState().detailOverrides).toHaveLength(1);expect(useHub.getState().correctionAudit).toHaveLength(2);
 expect((useHub.getState().correctionAudit[1].before as LiveMonthly).past3MonthsAvgHourlyRate).toBeUndefined();
 expect(useHub.getState().correctionAudit[1]).toMatchObject({after:{past3MonthsAvgHourlyRate:62.75}});
 expect(useHub.persist.getOptions().name).toBe('meimei-staffhub-department-rules-v1');expect(useHub.persist.getOptions().version).toBe(1);
});

it('清空平均时薪恢复未定义，经过JSON持久化和刷新后仍不补零且保留修订前值',async()=>{
 saveMonthly({past3MonthsAvgHourlyRate:62.75});
 saveMonthly({past3MonthsAvgHourlyRate:undefined},'历史口径待复核');
 expect(hostRow().past3MonthsAvgHourlyRate).toBeUndefined();
 const audit=useHub.getState().correctionAudit.at(-1)!;
 expect(audit.before).toMatchObject({past3MonthsAvgHourlyRate:62.75});
 expect((audit.after as LiveMonthly).past3MonthsAvgHourlyRate).toBeUndefined();
 const saved=JSON.parse(JSON.stringify(useHub.persist.getOptions().partialize!(useHub.getState())));
 useHub.persist.setOptions({storage:{getItem:()=>({state:saved,version:1}),setItem:()=>{},removeItem:()=>{}}});
 useHub.getState().reset();await useHub.persist.rehydrate();useHub.getState().cleanDataset();
 expect(hostRow().past3MonthsAvgHourlyRate).toBeUndefined();
 expect(useHub.getState().correctionAudit.at(-1)?.reason).toBe('历史口径待复核');
});

it('人工部门归属用于发布和核算，工资快照冻结修订及原因且不改基础档案',()=>{
 const employees=useHub.getState().employees.map(e=>e.id==='host'?{...e,departmentId:'ads'}:e);
 useHub.setState({employees});useHub.getState().cleanDataset();saveMonthly({departmentId:'live',hours:4,spend:400,premium:800,waitingSalaryDays:7,past3MonthsAvgHourlyRate:75.5});
 useHub.getState().publishDepartmentRule('rule','2026-10');
 expect(useHub.getState().payrollTasks[0].employeeIds).toContain('host');
 useHub.getState().runPayroll();archiveCurrentMonth();
 const batch=useHub.getState().batch!;
 expect(batch.salaries.find(s=>s.employeeId==='host')).toMatchObject({total:200,departmentName:'直播部'});
 expect(batch.snapshot.monthly.find(r=>r.employeeId==='host')).toMatchObject({hours:4,waitingSalaryDays:7,past3MonthsAvgHourlyRate:75.5});
 expect(batch.snapshot.monthlyOverrides).toHaveLength(1);expect(batch.snapshot.correctionAudit?.[0].reason).toBe('核对月度');
 expect(useHub.getState().employees.find(e=>e.id==='host')?.departmentId).toBe('ads');
 expect(()=>saveMonthly({hours:5})).toThrow('归档');
 expect(()=>saveMonthly({waitingSalaryDays:8})).toThrow('归档');
 expect(()=>saveMonthly({past3MonthsAvgHourlyRate:80})).toThrow('归档');
 expect(useHub.getState().batch!.snapshot).toEqual(batch.snapshot);
});

it('修订导致已发布名单变化时核算拒绝，任务快照不被修订改写',()=>{
 useHub.getState().publishDepartmentRule('rule','2026-10');const tasks=structuredClone(useHub.getState().payrollTasks);
 saveDetail({hostId:'replacement'});
 expect(()=>useHub.getState().runPayroll()).toThrow('名单');
 expect(useHub.getState().payrollTasks).toEqual(tasks);expect(useHub.getState().batch).toBeNull();expect(useHub.getState().archivedMonths).toEqual([]);
});
