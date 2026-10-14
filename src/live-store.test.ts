import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import type { LiveRecord, RoomHourly } from './live-domain';

const record:LiveRecord={id:'record',roomId:'room-primary',productId:'product',date:'2026-10-01',start:'02:00',end:'03:00',hostId:'host',buyerId:'buyer',controlId:'control',version:1};
const room:RoomHourly={id:'room',roomId:'room-primary',productId:'product',accountId:'room-account',date:record.date,start:record.start,end:record.end,spend:100,revenue:200,clicks:20,clickRate:0.2,clickCost:5,conversions:10,conversionRate:0.5,conversionCost:10,roi:2,orders:10,viewers:100,fans:5,tips:0};
beforeEach(()=>{
 useHub.getState().reset();
 useHub.setState({month:'2026-10',employees:['host','buyer','control'].map(id=>({id,name:id,departmentId:'live',position:'主播',joined:'2026-01-01',status:'在职',phone:'',email:'',identities:[],role:'员工'})),departments:[{id:'live',name:'直播部',active:true}],products:[{id:'product',name:'示例',accountId:'ad-account',platform:'巨量引擎',active:true}],rooms:[{id:'room-primary',name:'示例直播间',platformAccountId:'room-account',productId:'product',active:true}],liveRecords:[record],adHours:[],roomHours:[room],archivedMonths:[],liveDetails:[],monthlyRows:[],dataset:{rows:[],month:'2026-10',version:0,revision:0,published:false},revision:1,batch:null,batches:{},departmentRules:[{id:'rule',name:'示例时薪',departmentId:'live',version:1,status:'草稿',roomIds:['room-primary'],expression:['roi'],metrics:[{id:'roi',field:'roi',durationField:'hours',bands:[{keyType:'range',min:0,includeMin:true,includeMax:true,rate:50}]}]}],payrollTasks:[]});
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
it('产品与直播间 ID、名称全局唯一并规范化，校验平台和账户',()=>{
 const s=useHub.getState(),product=s.products[0],room=s.rooms[0];
 expect(()=>s.saveProduct({...product,id:'new'})).toThrow('唯一');
 expect(()=>s.saveProduct({...product,platform:'不存在'})).toThrow('平台');
 expect(()=>s.saveProduct({...product,accountId:' '})).toThrow('账户');
 expect(()=>s.saveRoom({...room,platformAccountId:' '})).toThrow('账户');
 expect(()=>s.saveRoom({...room,productId:'missing'})).toThrow('产品');
 s.saveProduct({...product,id:' Ｐ002 ',name:' 产品二 ',accountId:' ＡＤ002 '});
 expect(useHub.getState().products[1]).toMatchObject({id:'P002',name:'产品二',accountId:'AD002'});
 expect(()=>s.saveProduct({...product,id:'Ｐ002',name:'新名'})).toThrow('ID');
 s.saveRoom({...room,id:' Ｒ002 ',name:' 直播间二 ',platformAccountId:' ＲＡ002 '});
 expect(useHub.getState().rooms[1]).toMatchObject({id:'R002',name:'直播间二',platformAccountId:'RA002'});
 expect(()=>s.saveRoom({...room,id:'Ｒ002',name:'不同名',platformAccountId:'new'})).toThrow('ID');
 s.saveProduct({...product,active:false});
 expect(()=>s.saveProduct({...product,id:'another'})).toThrow('唯一');
});
it('持久化只保存配置标记并保留原命名空间',()=>{
 expect(useHub.persist.getOptions().name).toBe('meimei-staffhub-department-rules-v1');
 expect(useHub.persist.getOptions().version).toBe(1);
 const product=useHub.getState().products[0];
 useHub.getState().saveProduct({...product,access:{appId:'app',secretConfigured:true,authCodeConfigured:true,secret:'secret',authCode:'code'} as typeof product.access});
 const saved=useHub.persist.getOptions().partialize?.(useHub.getState()) as ReturnType<typeof useHub.getState>;
 expect(saved.products[0].access).toEqual({appId:'app',secretConfigured:true,authCodeConfigured:true});
 expect(saved.archivedMonths).toEqual([]);expect(saved.liveRecords).toEqual([record]);expect(saved.session).toBeUndefined();
 expect(saved).not.toHaveProperty('projects');expect(saved).not.toHaveProperty('rules');expect(saved).not.toHaveProperty('scheme');
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
 useHub.getState().saveProduct({...useHub.getState().products[0],name:'改名产品',active:false,access:{appId:'new-app',secretConfigured:true,authCodeConfigured:true}});
 useHub.getState().saveRoom({...useHub.getState().rooms[0],name:'改名直播间',active:false});
 useHub.getState().lockBatch();useHub.getState().publishBatch();
 expect(useHub.getState().batch?.snapshot).toEqual(frozen?.snapshot);
 expect(useHub.getState().batch?.salaries).toEqual(frozen?.salaries);
 expect(useHub.getState().liveDetails[0].productName).toBe('示例');expect(useHub.getState().liveDetails[0].roomName).toBe('示例直播间');
});
it('当天直播录入缺小时源，模拟同步补齐全天并贯通统计',()=>{
 useHub.getState().saveLiveRecords([{...record,id:'today',date:'2026-10-13'}]);
 expect(()=>useHub.getState().cleanDataset()).toThrow('缺少');
 const beforeRevision=useHub.getState().revision;
 useHub.getState().sync();
 const synced=useHub.getState();
 expect(synced.revision).toBe(beforeRevision+1);
 expect(synced.roomHours.filter(r=>r.date==='2026-10-13')).toHaveLength(24);
 expect(synced.adHours.filter(r=>r.date==='2026-10-13')).toHaveLength(0);
 expect(synced.roomHours.find(r=>r.date==='2026-10-01'&&r.start==='02:00')).toEqual(room);
 expect(synced.roomHours.find(r=>r.date==='2026-10-13'&&r.start==='23:00')?.end).toBe('24:00');
 expect(synced.roomHours.filter(r=>r.date==='2026-10-13').every(r=>(r.clickRateDenominator??0)>0&&(r.conversionRateDenominator??0)>0&&r.spend>0&&r.revenue>0)).toBe(true);
 expect(synced.toast).toContain('模拟');
 useHub.getState().cleanDataset();
 expect(useHub.getState().liveDetails).toHaveLength(2);
 expect(useHub.getState().monthlyRows.find(r=>r.employeeId==='host')?.hours).toBe(2);
});
it('模拟同步按业务键补齐多产品多直播间，重复同步不累加金额或版本',()=>{
 const s=useHub.getState(),product=s.products[0],primary=s.rooms[0];
 useHub.setState({products:[product,{...product,id:'second',name:'第二产品'},{...product,id:'inactive',name:'停用产品',active:false}],rooms:[primary,{...primary,id:'room-second',name:'第二直播间',platformAccountId:'room-second'},{...primary,id:'second-room',productId:'second',platformAccountId:'second-room'},{...primary,id:'inactive-room',productId:'inactive',platformAccountId:'inactive-room'}]});
 useHub.getState().sync();
 const first=structuredClone({adHours:useHub.getState().adHours,roomHours:useHub.getState().roomHours,revision:useHub.getState().revision});
 expect(first.adHours).toHaveLength(0);expect(first.roomHours).toHaveLength(72);
 expect(first.roomHours.some(r=>r.productId==='inactive')).toBe(false);expect(first.roomHours.find(r=>r.id===room.id)).toEqual(room);
 useHub.getState().sync();expect(useHub.getState().adHours).toEqual(first.adHours);expect(useHub.getState().roomHours).toEqual(first.roomHours);expect(useHub.getState().revision).toBe(first.revision);
});
it('有来源历史的产品和直播间禁止改变绑定，失败不修改来源版本',()=>{
 const s=useHub.getState(),products=structuredClone(s.products),rooms=structuredClone(s.rooms),revision=s.revision;
 s.saveProduct({...products[0],id:'second',name:'第二产品',platform:'磁力引擎',accountId:'second'});
 const beforeRevision=useHub.getState().revision;
 for(const change of [{platform:'磁力引擎'},{accountId:'replacement'}]) expect(()=>s.saveProduct({...products[0],...change})).toThrow('已有来源历史');
 for(const change of [{productId:'second'},{platformAccountId:'replacement'}]) expect(()=>s.saveRoom({...rooms[0],...change})).toThrow('已有来源历史');
 expect(useHub.getState().products[0]).toEqual(products[0]);expect(useHub.getState().rooms).toEqual(rooms);expect(useHub.getState().revision).toBe(beforeRevision);expect(beforeRevision).toBe(revision+1);
});
it('同平台账户跨产品仍只能绑定一个直播间，停用也不能重复',()=>{
 const s=useHub.getState(),product=s.products[0],primary=s.rooms[0];
 s.saveProduct({...product,id:'second',name:'第二产品',accountId:'second'});
 expect(()=>s.saveRoom({...primary,id:'duplicate',name:'重复',productId:'second'})).toThrow('只能绑定');
 s.saveRoom({...primary,active:false});
 expect(()=>s.saveRoom({...primary,id:'duplicate',name:'重复',productId:'second'})).toThrow('只能绑定');
 s.saveProduct({...product,id:'other-platform',name:'另一平台产品',platform:'磁力引擎'});
 expect(()=>s.saveRoom({...primary,id:'other-room',name:'另一平台直播间',productId:'other-platform'})).not.toThrow();
});
it('停用直播间或其关联产品不能录入，关系不匹配不能录入',()=>{
 const s=useHub.getState();s.saveRoom({...s.rooms[0],active:false});
 expect(()=>s.saveLiveRecords([{...record,version:2}])).toThrow('停用');
 s.saveRoom({...s.rooms[0],active:true});s.saveProduct({...s.products[0],active:false});
 expect(()=>s.saveLiveRecords([{...record,version:2}])).toThrow('停用');
 expect(()=>s.saveLiveRecords([{...record,version:2,productId:'other'}])).toThrow('归属');
 expect(useHub.getState().liveRecords).toEqual([record]);
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

it('规则保存、发布和核算均拒绝已停用关联产品，即使直播间仍启用',()=>{
 const s=useHub.getState();s.cleanDataset();publishRule();
 s.saveProduct({...s.products[0],active:false});s.cleanDataset();
 const rule=useHub.getState().departmentRules[0];
 expect(()=>s.saveDepartmentRule({...rule,id:'new-rule'})).toThrow('启用');
 expect(()=>s.publishDepartmentRule(rule.id,'2026-10')).toThrow('重复');
 useHub.setState({payrollTasks:[]});expect(()=>s.publishDepartmentRule(rule.id,'2026-10')).toThrow('停用');
 useHub.setState({payrollTasks:[{id:'task',month:'2026-10',ruleId:rule.id,ruleName:rule.name,ruleVersion:1,departmentId:'live',datasetVersion:1,datasetRevision:1,status:'待核算',rule,employeeIds:['host','buyer','control'],created:''}]});
 expect(()=>s.runPayroll()).toThrow('停用');expect(useHub.getState().archivedMonths).toEqual([]);
});
