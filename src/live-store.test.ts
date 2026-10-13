import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import type { LiveRecord, RoomHourly } from './live-domain';

const record:LiveRecord={id:'record',projectId:'project',date:'2026-10-01',start:'02:00',end:'03:00',hostId:'host',buyerId:'buyer',controlId:'control',version:1};
const room:RoomHourly={id:'room',projectId:'project',accountId:'room-account',date:record.date,start:record.start,end:record.end,spend:100,revenue:200,clicks:20,clickRate:0.2,clickCost:5,conversions:10,conversionRate:0.5,conversionCost:10,roi:2,orders:10,viewers:100,fans:5,tips:0};
beforeEach(()=>{
 useHub.getState().reset();
 useHub.setState({month:'2026-10',employees:['host','buyer','control'].map(id=>({id,name:id,departmentId:'live',position:'主播',joined:'2026-01-01',status:'在职',phone:'',email:'',identities:[],role:'员工'})),departments:[{id:'live',name:'直播部',active:true}],projects:[{id:'project',name:'示例',code:'DEMO',account:'ad-account',platform:'巨量引擎',active:true,liveAccountIds:['room-account']}],liveRecords:[record],adHours:[],roomHours:[room],archivedMonths:[],liveDetails:[],monthlyRows:[],dataset:{rows:[],month:'2026-10',version:0,revision:0,published:false},revision:1,batch:null,batches:{},departmentRules:[{id:'rule',name:'示例时薪',departmentId:'live',version:1,status:'草稿',projectIds:['project'],expression:['roi'],metrics:[{id:'roi',field:'roi',durationField:'hours',bands:[{keyType:'range',min:0,includeMin:true,includeMax:true,rate:50}]}]}],payrollTasks:[],rules:[{id:'rule',name:'示例时薪',version:1,mode:'single',measures:[{metric:'roi',bands:[{min:0,includeMin:true,includeMax:true,rate:50}]}]}],scheme:{name:'主播薪资',version:1,fixedSalary:0,departmentIds:['live'],employeeIds:['host'],groups:[{id:'group',name:'示例',projectIds:['project'],hourlyRuleId:'rule'}]}});
});
const publishRule = () => useHub.getState().publishDepartmentRule('rule',useHub.getState().month);
it('批量upsert拒绝重复ID且不留下部分写入',()=>{
 const before=structuredClone(useHub.getState().liveRecords);
 expect(()=>useHub.getState().saveLiveRecords([{...record,id:'new'}, {...record,id:'new'}])).toThrow('重复');
 expect(useHub.getState().liveRecords).toEqual(before);
});
it('已归档原日期不能通过编辑移出历史月份',()=>{
 useHub.setState({archivedMonths:['2026-10']});
 expect(()=>useHub.getState().saveLiveRecords([{...record,date:'2026-11-01'}])).toThrow('归档');
 expect(useHub.getState().liveRecords).toEqual([record]);
});
it('包含新归档日期的混合批量上传整批拒绝',()=>{
 useHub.setState({archivedMonths:['2026-09']});
 expect(()=>useHub.getState().saveLiveRecords([{...record,id:'nov',date:'2026-11-01'},{...record,id:'sep',date:'2026-09-01'}])).toThrow('归档');
 expect(useHub.getState().liveRecords).toEqual([record]);
});
it('upsert更新指定ID并保留未上传的历史记录',()=>{
 useHub.setState({liveRecords:[record,{...record,id:'nov',date:'2026-11-01'}]});
 useHub.getState().saveLiveRecords([{...record,version:2}]);
 expect(useHub.getState().liveRecords).toHaveLength(2);
 expect(useHub.getState().liveRecords.find(r=>r.id==='record')?.version).toBe(2);
});
it('非整小时直播记录写入拒绝',()=>{
 expect(()=>useHub.getState().saveLiveRecords([{...record,start:'02:30',version:2}])).toThrow('整小时');
 expect(useHub.getState().liveRecords).toEqual([record]);
});
it('缺小时来源仍允许保存但统计与核算阻断',()=>{
 useHub.getState().saveLiveRecords([{...record,id:'nov',date:'2026-11-01'}]);
 useHub.getState().setMonth('2026-11');
 expect(()=>useHub.getState().cleanDataset()).toThrow();
 expect(()=>useHub.getState().runPayroll()).toThrow();
 expect(useHub.getState().archivedMonths).toEqual([]);
 expect(useHub.getState().liveRecords).toHaveLength(2);
});
it('成功核算与归档同时更新，归档月所有来源写入入口拒绝',()=>{
 useHub.getState().cleanDataset();publishRule();useHub.getState().runPayroll();
 expect(useHub.getState().archivedMonths).toEqual(['2026-10']);
 expect(useHub.getState().batches['2026-10']).toEqual(useHub.getState().batch);
 expect(()=>useHub.getState().sync()).toThrow('归档');
 expect(()=>useHub.getState().cleanDataset()).toThrow('归档');
 expect(()=>useHub.getState().runPayroll()).toThrow('归档');
 expect(()=>useHub.getState().saveLiveRecords([{...record,version:2}])).toThrow('归档');
});
it('核算失败不归档或保存批次',()=>{
 useHub.getState().cleanDataset();
 publishRule();
 useHub.setState({dataset:{...useHub.getState().dataset,rows:[]}});
 expect(()=>useHub.getState().runPayroll()).toThrow();
 expect(useHub.getState().archivedMonths).toEqual([]);
 expect(useHub.getState().batch).toBeNull();
 expect(useHub.getState().batches).toEqual({});
});
it('归档核算冻结完整依据，其他月和基础档案修改后仍可锁定发布',()=>{
 useHub.getState().cleanDataset();publishRule();useHub.getState().runPayroll();
 const salaries=structuredClone(useHub.getState().batch?.salaries);
 useHub.getState().setMonth('2026-11');
 useHub.getState().saveLiveRecords([{...record,id:'nov',date:'2026-11-01'}]);
 useHub.getState().saveEmployee({...useHub.getState().employees[0],name:'改名'});
 useHub.getState().setMonth('2026-10');useHub.getState().lockBatch();useHub.getState().publishBatch();
 expect(useHub.getState().batch?.status).toBe('已发布');
 expect(useHub.getState().batch?.salaries).toEqual(salaries);
 expect(useHub.getState().batch?.snapshot?.records[0]).toEqual(record);
 expect(useHub.getState().batch?.snapshot?.employees[0].name).toBe('host');
});
it('姓名trim和Unicode规范化，包含离职员工全局唯一',()=>{
 useHub.getState().saveEmployee({...useHub.getState().employees[0],name:'  Ａlice  '});
 expect(useHub.getState().employees[0].name).toBe('Alice');
 useHub.getState().saveEmployee({...useHub.getState().employees[0],status:'已离职'});
 expect(()=>useHub.getState().saveEmployee({...useHub.getState().employees[1],name:'Ａlice'})).toThrow('唯一');
 expect(()=>useHub.getState().saveEmployee({...useHub.getState().employees[1],name:'  '})).toThrow('姓名');
});
it('项目编码唯一，平台和账户校验，直播账户去重',()=>{
 const project=useHub.getState().projects[0];
 expect(()=>useHub.getState().saveProject({...project,id:'new'})).toThrow('编码');
 expect(()=>useHub.getState().saveProject({...project,platform:'不存在'})).toThrow('平台');
 expect(()=>useHub.getState().saveProject({...project,account:' '})).toThrow('账户');
 expect(()=>useHub.getState().saveProject({...project,liveAccountIds:[]})).toThrow('账户');
 useHub.setState({liveRecords:[],roomHours:[],adHours:[]});
 for(const platform of ['巨量引擎','磁力引擎','腾讯 ADQ']) useHub.getState().saveProject({...project,platform});
 useHub.getState().saveProject({...project,liveAccountIds:[' room-account ','room-account']});
 expect(useHub.getState().projects[0].liveAccountIds).toEqual(['room-account']);
});
it('存在来源历史时禁止无声改变项目编码',()=>{
 expect(()=>useHub.getState().saveProject({...useHub.getState().projects[0],code:'CHANGED'})).toThrow('历史');
});
it('持久化只保存配置标记并使用新命名空间保留旧数据',()=>{
 expect(useHub.persist.getOptions().name).toBe('meimei-staffhub-department-rules-v1');
 const project=useHub.getState().projects[0];
 useHub.getState().saveProject({...project,access:{appId:'app',secretConfigured:true,authCodeConfigured:true,secret:'secret',authCode:'code'} as typeof project.access});
 const saved=useHub.persist.getOptions().partialize?.(useHub.getState()) as ReturnType<typeof useHub.getState>;
 expect(saved.projects[0].access).toEqual({appId:'app',secretConfigured:true,authCodeConfigured:true});
 expect(saved.archivedMonths).toEqual([]);
 expect(saved.liveRecords).toEqual([record]);
 expect(saved.session).toBeUndefined();
});
it('跨月核算保留各月批次并从归档快照恢复两表',()=>{
 useHub.getState().cleanDataset();publishRule();useHub.getState().runPayroll();useHub.getState().lockBatch();useHub.getState().publishBatch();
 const october=structuredClone(useHub.getState().batch);
 useHub.setState({roomHours:[room,{...room,id:'nov-room',date:'2026-11-01'}]});
 useHub.getState().setMonth('2026-11');useHub.getState().saveLiveRecords([{...record,id:'nov',date:'2026-11-01'}]);
 useHub.getState().cleanDataset();publishRule();useHub.getState().runPayroll();
 expect(useHub.getState().archivedMonths).toEqual(['2026-10','2026-11']);
 expect(useHub.getState().batches['2026-10']).toEqual(october);
 useHub.getState().setMonth('2026-10');
 expect(useHub.getState().batch).toEqual(october);
 expect(useHub.getState().dataset).toEqual(october?.snapshot.dataset);
 expect(useHub.getState().monthlyRows).toEqual(october?.snapshot.monthly);
 expect(useHub.getState().liveDetails).toEqual(october?.snapshot.details);
});
it('归档来源和冻结依据进入持久化导出，运行时登录信息不进入',()=>{
 useHub.getState().cleanDataset();publishRule();useHub.getState().runPayroll();
 const saved=useHub.persist.getOptions().partialize?.(useHub.getState()) as ReturnType<typeof useHub.getState>;
 expect(saved.archivedMonths).toEqual(['2026-10']);
 expect(saved.liveRecords).toEqual([record]);expect(saved.roomHours).toEqual([room]);
 expect(saved.batches['2026-10'].snapshot.records).toEqual([record]);
 expect(saved.batches['2026-10'].snapshot.dataset.rows).toEqual(saved.monthlyRows);
 expect(saved.session).toBeUndefined();
});
it('混合人员非法上传整批拒绝且不修改来源版本',()=>{
 const revision=useHub.getState().revision;
 expect(()=>useHub.getState().saveLiveRecords([{...record,id:'nov',date:'2026-11-01'},{...record,id:'invalid',date:'2026-11-02',hostId:'missing'}])).toThrow();
 expect(useHub.getState().liveRecords).toEqual([record]);expect(useHub.getState().revision).toBe(revision);
});
it('同ID记录只接受严格递增版本，旧编辑不能覆盖新版本',()=>{
 useHub.getState().saveLiveRecords([{...record,version:2}]);
 const revision=useHub.getState().revision;
 for(const version of [1,2]) expect(()=>useHub.getState().saveLiveRecords([{...record,version}])).toThrow('版本');
 expect(useHub.getState().liveRecords).toEqual([{...record,version:2}]);
 expect(useHub.getState().revision).toBe(revision);
 useHub.getState().saveLiveRecords([{...record,version:3}]);
 expect(useHub.getState().liveRecords[0].version).toBe(3);
});
it('归档后项目资料修改不改变冻结来源和统计',()=>{
 useHub.getState().cleanDataset();publishRule();useHub.getState().runPayroll();
 const frozen=structuredClone(useHub.getState().batch);
 useHub.getState().saveProject({...useHub.getState().projects[0],name:'改名项目',access:{appId:'new-app',secretConfigured:true,authCodeConfigured:true}});
 useHub.getState().lockBatch();useHub.getState().publishBatch();
 expect(useHub.getState().batch?.snapshot).toEqual(frozen?.snapshot);
 expect(useHub.getState().batch?.salaries).toEqual(frozen?.salaries);
 expect(useHub.getState().liveDetails[0].projectName).toBe('示例');
});
it('当天直播录入缺小时源，模拟同步补齐全天并贯通统计',()=>{
 useHub.getState().saveLiveRecords([{...record,id:'today',date:'2026-10-13'}]);
 expect(()=>useHub.getState().cleanDataset()).toThrow('缺少');
 const beforeRevision=useHub.getState().revision;
 useHub.getState().sync();
 const synced=useHub.getState();
 expect(synced.revision).toBe(beforeRevision+1);
 expect(synced.roomHours.filter(r=>r.date==='2026-10-13')).toHaveLength(24);
 expect(synced.adHours.filter(r=>r.date==='2026-10-13')).toHaveLength(24);
 expect(synced.roomHours.find(r=>r.date==='2026-10-01'&&r.start==='02:00')).toEqual(room);
 expect(synced.roomHours.find(r=>r.date==='2026-10-13'&&r.start==='23:00')?.end).toBe('24:00');
 expect(synced.roomHours.filter(r=>r.date==='2026-10-13').every(r=>(r.clickRateDenominator??0)>0&&(r.conversionRateDenominator??0)>0&&r.spend>0&&r.revenue>0)).toBe(true);
 expect(synced.toast).toContain('模拟');
 useHub.getState().cleanDataset();
 expect(useHub.getState().liveDetails).toHaveLength(2);
 expect(useHub.getState().monthlyRows.find(r=>r.employeeId==='host')?.hours).toBe(2);
});
it('模拟同步按业务键补齐多项目多账户，重复同步不累加金额或版本',()=>{
 const project=useHub.getState().projects[0];
 useHub.setState({projects:[{...project,liveAccountIds:['room-account','room-second']},{...project,id:'second',code:'SECOND',liveAccountIds:['second-room']},{...project,id:'inactive',code:'INACTIVE',active:false,liveAccountIds:['inactive-room']}]});
 useHub.getState().sync();
 const first=structuredClone({adHours:useHub.getState().adHours,roomHours:useHub.getState().roomHours,revision:useHub.getState().revision});
 expect(first.adHours).toHaveLength(48);expect(first.roomHours).toHaveLength(72);
 expect(first.roomHours.some(r=>r.projectId==='inactive')).toBe(false);
 expect(first.roomHours.find(r=>r.id===room.id)).toEqual(room);
 useHub.getState().sync();
 expect(useHub.getState().adHours).toEqual(first.adHours);expect(useHub.getState().roomHours).toEqual(first.roomHours);
 expect(useHub.getState().revision).toBe(first.revision);
});
it('有来源历史的项目禁止替换平台和账户，失败不修改项目或版本',()=>{
 const before=structuredClone(useHub.getState().projects),revision=useHub.getState().revision;
 for(const change of [{platform:'磁力引擎'},{account:'replacement'},{liveAccountIds:['replacement']},{liveAccountIds:['room-account','added']}]) {
  expect(()=>useHub.getState().saveProject({...before[0],...change})).toThrow('已有来源历史');
  expect(useHub.getState().projects).toEqual(before);expect(useHub.getState().revision).toBe(revision);
 }
});
it('有来源历史允许账户顺序改变但不允许移除账户',()=>{
 useHub.setState({projects:[{...useHub.getState().projects[0],liveAccountIds:['room-account','second']}]});
 useHub.getState().saveProject({...useHub.getState().projects[0],liveAccountIds:['second','room-account']});
 expect(useHub.getState().projects[0].liveAccountIds).toEqual(['second','room-account']);
 expect(()=>useHub.getState().saveProject({...useHub.getState().projects[0],liveAccountIds:['second']})).toThrow('已有来源历史');
});
it('入职状态非法人员混合上传整批失败，编辑也只允许在职员工',()=>{
 const employees=structuredClone(useHub.getState().employees);
 for(const status of ['待入职','已离职'] as const) for(const role of ['hostId','buyerId','controlId'] as const) {
  const employeeId=record[role],validEmployeeId=employees.find(e=>e.id!==employeeId)!.id;
  useHub.setState({employees:employees.map(e=>e.id===employeeId?{...e,status}:e)});
  const revision=useHub.getState().revision;
  expect(()=>useHub.getState().saveLiveRecords([{...record,id:'valid',date:'2026-10-02',hostId:validEmployeeId,buyerId:validEmployeeId,controlId:validEmployeeId},{...record,id:'invalid',date:'2026-10-03'}])).toThrow('在职');
  expect(useHub.getState().liveRecords).toEqual([record]);expect(useHub.getState().revision).toBe(revision);
  expect(()=>useHub.getState().saveLiveRecords([{...record,version:2}])).toThrow('在职');
 }
});
it('三岗位入职日前的直播记录拒绝写入，空入职日期兼容待维护档案',()=>{
 const employees=structuredClone(useHub.getState().employees);
 for(const id of ['host','buyer','control']) {
  useHub.setState({employees:employees.map(e=>e.id===id?{...e,joined:'2026-10-02'}:e)});
  const revision=useHub.getState().revision;
  expect(()=>useHub.getState().saveLiveRecords([{...record,id:'valid',date:'2026-10-02'},{...record,version:2}])).toThrow('入职日期之前');
  expect(useHub.getState().liveRecords).toEqual([record]);expect(useHub.getState().revision).toBe(revision);
 }
 useHub.setState({employees:employees.map(e=>({...e,joined:''}))});
 useHub.getState().saveLiveRecords([{...record,version:2}]);
 expect(useHub.getState().liveRecords[0].version).toBe(2);
});
it('非空员工入职日期必须为严格日历日期',()=>{
 const employees=structuredClone(useHub.getState().employees);
 for(const joined of ['2026-02-30','2026-2-01','2026-10','未知日期']) {
  useHub.setState({employees:employees.map(e=>e.id==='buyer'?{...e,joined}:e)});
  expect(()=>useHub.getState().saveLiveRecords([{...record,id:'new',date:'2026-10-02'}])).toThrow('入职日期无效');
  expect(useHub.getState().liveRecords).toEqual([record]);
 }
});
