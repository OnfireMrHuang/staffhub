import { scheduleTestMonth, loadLegacyPendingInputs } from './payroll-test-fixtures';
import {beforeEach,expect,it} from 'vitest';
import {useHub} from './store';
import type {CompensationRule} from './compensation-rules';
import {monthlyRowKey} from './dataset-corrections';
const archiveCurrentMonth = () => { useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});const s=useHub.getState();s.archivePayroll(s.month,s.batch!.review!.version); };
const allowance=(id='allow',amount=20):CompensationRule=>({id,name:id,version:1,status:'草稿',scope:'global',roomIds:[],type:'allowance',allowance:{field:'nightSessions',amount}});
const hourly=(id:string,rate:number,guarantee=false):CompensationRule=>({id,name:id,version:1,status:'草稿',scope:'global',roomIds:[],type:'hourly',hourly:{duration:'hours',items:[{id:'item',name:'项目',kind:guarantee?'guarantee':'special',rate}],formula:guarantee?{mode:'guarantee',itemId:'item'}:{mode:'additions',itemIds:['item']}}});
const publish=(rule:CompensationRule)=>{useHub.getState().saveCompensationRule(rule);useHub.getState().publishCompensationRule(rule.id,'2026-10');};
beforeEach(()=>{
 useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});
 const s=useHub.getState(),employee={...s.employees[0],joined:'2026-01-01',status:'在职' as const,nonCompeteSigned:true},room=s.rooms[0],product=s.products.find(p=>p.id===room.productId)!;
 const row={...s.dataset.rows.find(r=>r.roomId===room.id)!,employeeId:employee.id,employeeName:employee.name,departmentId:employee.departmentId,roomId:room.id,productId:product.id,month:'2026-10',hours:10,nightHours:2,earlyHours:3,regularHours:5,premium:1000,nightPremium:0,earlyPremium:200,regularPremium:800,spend:100,roi:10,hourlySpend:10,sessions:4,nightSessions:2,earlySessions:2,roiRank:1};
 useHub.setState({employees:[employee],liveRecords:[],roomHours:[],adHours:[],rooms:[{...room,openedOn:'2026-01-01'}],products:[product],dataset:{rows:[row],month:'2026-10',revision:1,version:1,published:true},monthlyRows:[row],revision:1,compensationRules:[],compensationTasks:[],payrollTasks:[]});
});
beforeEach(scheduleTestMonth);
it('merges every published rule once per row and freezes the full new task/result context',()=>{
 publish(allowance());publish(allowance('global-extra',10));
 publish(hourly('floor',60,true));publish(hourly('add30',30));publish(hourly('add50',50));
 useHub.getState().runPayroll();const s=useHub.getState();
 expect(s.batch?.salaries[0].total).toBe(860);
 expect(s.batch?.compensationResult?.rows[0]).toMatchObject({allowance:60,premium:{coefficient:1,after:1000},durationGroups:[{rate:80,amount:800}],total:860});
 expect(s.dataset.rows[0].premium).toBe(1000);expect(s.archivedMonths).toEqual([]);
 expect(s.compensationTasks.every(t=>t.status==='已核算')).toBe(true);
 expect(s.batch?.snapshot.compensationRules).toHaveLength(5);expect(s.batch?.snapshot.compensationTasks).toHaveLength(5);
 expect(s.batch?.snapshot.compensationTasks?.[0]).toMatchObject({referenceDate:'2026-10-31',employeeIds:[s.employees[0].id],rowKeys:[monthlyRowKey(s.dataset.rows[0])],datasetRevision:1,datasetVersion:1});
});
it('published definitions survive draft edits until a new version is explicitly published',()=>{
 publish(allowance());const rule=structuredClone(useHub.getState().publishedCompensationRules[0]);
 useHub.getState().saveCompensationRule(allowance('allow',30));
 expect(useHub.getState().compensationRules[0]).toMatchObject({version:2,status:'草稿'});
 expect(useHub.getState().publishedCompensationRules[0]).toEqual(rule);
 expect(useHub.getState().compensationTasks).toEqual([]);
 useHub.getState().publishCompensationRule('allow');
 expect(useHub.getState().publishedCompensationRules).toHaveLength(1);
 expect(useHub.getState().publishedCompensationRules[0]).toMatchObject({version:2,allowance:{amount:30}});
 expect(()=>useHub.getState().publishCompensationRule('allow')).toThrow(/重复/);
 useHub.getState().runPayroll();expect(useHub.getState().batch?.salaries[0].total).toBe(60);
});

it('legacy input snapshots still reject changed roster and row grains',()=>{
 for(const change of ['employee','room'] as const){
  const original=structuredClone(useHub.getState().dataset.rows[0]);publish(allowance());loadLegacyPendingInputs();const s=useHub.getState();
  const changed=change==='employee'?{...original,employeeId:'replacement'}:{...original,roomId:'replacement'};
  useHub.setState({employees:change==='employee'?[{...s.employees[0],id:'replacement'}]:s.employees,rooms:change==='room'?[{...s.rooms[0],id:'replacement'}]:s.rooms,dataset:{...s.dataset,rows:[changed]}});
  expect(()=>useHub.getState().runPayroll()).toThrow(/名单|粒度|数据行/);expect(useHub.getState().batch).toBeNull();expect(useHub.getState().archivedMonths).toEqual([]);
  useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});const reset=useHub.getState();const row=reset.dataset.rows[0];useHub.setState({dataset:{...reset.dataset,rows:[row]},compensationRules:[],compensationTasks:[],payrollTasks:[]});
 }
});
it('blocks duplicate grain, stale source and inactive participants atomically',()=>{
 publish(allowance());const baseline=useHub.getState(),dataset=structuredClone(baseline.dataset),employee=baseline.employees[0],room=baseline.rooms[0];
 const mutations=[{dataset:{...dataset,rows:[...dataset.rows,...dataset.rows]}},{revision:2},{employees:[{...employee,status:'已离职' as const}]},{rooms:[{...room,active:false}]}];
 for(const mutation of mutations){useHub.setState({revision:1,dataset,employees:[employee],liveRecords:[],roomHours:[],adHours:[],rooms:[room],...mutation});expect(()=>useHub.getState().runPayroll()).toThrow();expect(useHub.getState().batch).toBeNull();expect(useHub.getState().batches).toEqual({});expect(useHub.getState().archivedMonths).toEqual([]);expect(useHub.getState().compensationTasks).toEqual([]);}
});
it('a bad second rule cannot leave a partially calculated batch or task transition',()=>{
 publish(allowance());publish(hourly('bad',20));const s=useHub.getState();
 useHub.setState({publishedCompensationRules:s.publishedCompensationRules.map(rule=>rule.id==='bad'?{...rule,hourly:{...rule.hourly!,items:[{id:'item',name:'错误',kind:'special',rate:Infinity}]}}:rule)});
 expect(()=>useHub.getState().runPayroll()).toThrow();expect(useHub.getState().batch).toBeNull();expect(useHub.getState().compensationTasks.every(t=>t.status==='待核算')).toBe(true);
});
it('legacy tasks still calculate, and mixed models require withdrawing old tasks',()=>{
 const s=useHub.getState(),legacy=s.departmentRules.find(r=>r.departmentId===s.employees[0].departmentId && r.roomIds.includes(s.rooms[0].id))!;
 publish(allowance());loadLegacyPendingInputs();s.publishDepartmentRule(legacy.id,'2026-10');
 expect(()=>useHub.getState().runPayroll()).toThrow(/旧|历史/);expect(useHub.getState().batch).toBeNull();
 useHub.getState().withdrawPayrollTask(useHub.getState().payrollTasks[0].id);useHub.getState().runPayroll();expect(useHub.getState().batch?.salaries[0].total).toBe(40);
});
it('archived rule/date/employee changes leave new salary evidence frozen',()=>{
 publish(allowance());useHub.getState().runPayroll();archiveCurrentMonth();const frozen=structuredClone(useHub.getState().batch);
 useHub.getState().saveEmployee({...useHub.getState().employees[0],name:'后改姓名',nonCompeteSigned:false,joined:'2026-10-31'});
 useHub.getState().saveRoom({...useHub.getState().rooms[0],openedOn:'2026-10-31'});useHub.getState().saveCompensationRule(allowance('allow',99));
 useHub.getState().publishBatch();expect(useHub.getState().batch?.snapshot).toEqual(frozen?.snapshot);expect(useHub.getState().batch?.compensationResult).toEqual(frozen?.compensationResult);
 expect(()=>useHub.getState().withdrawCompensationTask(useHub.getState().compensationTasks[0].id)).toThrow('归档');
});
it('new rules initialize once for old saves while empty arrays and all payroll history rehydrate without reset',()=>{
 const options=useHub.persist.getOptions(),current=useHub.getState();const legacy={...(options.partialize!(current) as object)} as Record<string,unknown>;delete legacy.compensationInitialized;delete legacy.compensationRules;delete legacy.compensationTasks;
 const migrated=options.merge!(legacy,current);expect(migrated.compensationRules).toHaveLength(2);expect(migrated.compensationRules.every(r=>r.status==='草稿')).toBe(true);expect(migrated.compensationInitialized).toBe(true);
 const saved={...legacy,compensationInitialized:true,compensationRules:[],compensationTasks:[]};const restored=options.merge!(saved,current);expect(restored.compensationRules).toEqual([]);expect(restored.compensationTasks).toEqual([]);expect(restored.departmentRules).toEqual(current.departmentRules);expect(restored.dataset).toEqual(current.dataset);
 expect(options.name).toBe('meimei-staffhub-department-rules-v1');expect(options.version).toBe(1);expect(options.partialize!(restored)).toMatchObject({compensationInitialized:true,compensationRules:[],compensationTasks:[]});
});
it('room openedOn preserves valid dates, rejects invalid calendars, and remains optional',()=>{
 const s=useHub.getState(),room=s.rooms[0],revision=s.revision;
 for(const openedOn of ['2026-02-30','2026-2-01','invalid']) expect(()=>s.saveRoom({...room,openedOn})).toThrow('开播日期');
 expect(useHub.getState().revision).toBe(revision);s.saveRoom({...room,openedOn:'2024-02-29'});expect(useHub.getState().rooms[0].openedOn).toBe('2024-02-29');s.saveRoom({...room,openedOn:undefined});expect(useHub.getState().rooms[0].openedOn).toBeUndefined();
});

it('checks dataset versions at calculation, while publication is independent of data readiness',()=>{
 publish(allowance());const dataset=useHub.getState().dataset;
 for(const version of [0,-1,NaN,Infinity,1.5]) {
  useHub.setState({dataset:{...dataset,version}});
  expect(()=>useHub.getState().runPayroll()).toThrow(/版本/);
  expect(useHub.getState().compensationTasks).toEqual([]);expect(useHub.getState().batch).toBeNull();
 }
});

it('rejects legacy task metadata drift without archiving or transitioning any task',()=>{
 publish(allowance());loadLegacyPendingInputs();const task=structuredClone(useHub.getState().compensationTasks[0]);
 for(const mutation of [{ruleVersion:2},{referenceDate:'2026-10-30'},{rowKeys:[...task.rowKeys,...task.rowKeys]},{employeeIds:[...task.employeeIds,...task.employeeIds]}]){useHub.setState({compensationTasks:[{...task,...mutation}]});expect(()=>useHub.getState().runPayroll()).toThrow();expect(useHub.getState().batch).toBeNull();expect(useHub.getState().archivedMonths).toEqual([]);}
});
it('persisted archived new payroll remains frozen when restored with newer current fields',()=>{
 publish(allowance());useHub.getState().runPayroll();archiveCurrentMonth();const options=useHub.persist.getOptions(),saved=structuredClone(options.partialize!(useHub.getState())) as Record<string,unknown>;
 const current=useHub.getState(),frozen=structuredClone(current.batch);const restored=options.merge!({...saved,employees:current.employees.map(employee=>({...employee,joined:'2026-10-31',nonCompeteSigned:false})),compensationRules:[]},current);
 expect(restored.batch).toEqual(frozen);expect(restored.batches['2026-10']).toEqual(frozen);expect(restored.compensationRules).toEqual([]);expect(restored.compensationTasks).toHaveLength(1);expect(restored.batch?.snapshot.employees[0].nonCompeteSigned).toBe(true);
});

it('新月度资料与班次字段随统计归档，之后改档案不覆盖冻结月度',()=>{
 useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});
 let s=useHub.getState();const original=s.monthlyRows[0],employee=s.employees.find(employee=>employee.id===original.employeeId)!,room=s.rooms.find(room=>room.id===original.roomId)!;
 s.saveEmployee({...employee,joined:'2026-09-01',nonCompeteSigned:true});s.saveRoom({...room,openedOn:'2026-08-01'});useHub.getState().cleanDataset();
 s=useHub.getState();const row=s.monthlyRows.find(row=>row.employeeId===employee.id&&row.roomId===room.id)!;
 expect(row).toMatchObject({employeeJoinedOn:'2026-09-01',nonCompeteSigned:true,roomOpenedOn:'2026-08-01'});
 expect(row.regularPremium).toBeCloseTo(row.premium-row.nightPremium!-row.earlyPremium!);expect(row.spendRank).toBeGreaterThan(0);
 scheduleTestMonth();publish(allowance());useHub.getState().runPayroll();archiveCurrentMonth();const frozen=structuredClone(useHub.getState().batch!.snapshot.monthly);
 useHub.getState().saveEmployee({...employee,joined:'2026-01-01',nonCompeteSigned:false});useHub.getState().saveRoom({...room,openedOn:'2026-01-01'});
 expect(useHub.getState().batch!.snapshot.monthly).toEqual(frozen);
});

it('keeps the saved rule category immutable without changing rules or tasks on rejection',()=>{
 const s=useHub.getState(),roomId=s.rooms[0].id;
 s.saveCompensationRule(allowance());
 const before=structuredClone(useHub.getState().compensationRules);
 expect(()=>useHub.getState().saveCompensationRule({...before[0],scope:'rooms',roomIds:[roomId]})).toThrow(/分类.*修改/);
 expect(useHub.getState().compensationRules).toEqual(before);
 expect(useHub.getState().compensationTasks).toEqual([]);
});
it('reserves rooms across saved draft and published rules regardless of calculation type but allows self edits',()=>{
 const s=useHub.getState(),roomId=s.rooms[0].id;
 s.saveCompensationRule({...allowance('owner'),scope:'rooms',roomIds:[roomId]});
 const duplicate={...hourly('other',50),scope:'rooms' as const,roomIds:[roomId]};
 expect(()=>useHub.getState().saveCompensationRule(duplicate)).toThrow(/直播间.*占用/);
 useHub.getState().publishCompensationRule('owner','2026-10');
 expect(()=>useHub.getState().saveCompensationRule(duplicate)).toThrow(/直播间.*占用/);
 const before=structuredClone(useHub.getState().compensationTasks);
 useHub.getState().saveCompensationRule({...useHub.getState().compensationRules[0],name:'修改本规则'});
 expect(useHub.getState().compensationRules).toHaveLength(1);
 expect(useHub.getState().compensationRules[0]).toMatchObject({scope:'rooms',roomIds:[roomId],version:2});
 expect(useHub.getState().compensationTasks).toEqual(before);
});
it('releases rooms removed from a rule and does not treat global rules as room ownership',()=>{
 const s=useHub.getState(),roomId=s.rooms[0].id,newRoom={...s.rooms[0],id:'second-room'};
 useHub.setState({rooms:[...s.rooms,newRoom]});
 s.saveCompensationRule(allowance('global'));
 s.saveCompensationRule(allowance('global-extra'));
 s.saveCompensationRule({...allowance('owner'),scope:'rooms',roomIds:[roomId]});
 useHub.getState().saveCompensationRule({...useHub.getState().compensationRules.find(r=>r.id==='owner')!,roomIds:[newRoom.id]});
 useHub.getState().saveCompensationRule({...hourly('replacement',50),scope:'rooms',roomIds:[roomId]});
 expect(useHub.getState().compensationRules.find(r=>r.id==='replacement')?.roomIds).toEqual([roomId]);
});
it('rejects publishing pre-existing conflicting room rules without creating a task',()=>{
 const roomId=useHub.getState().rooms[0].id;
 useHub.setState({compensationRules:[{...allowance('first'),scope:'rooms',roomIds:[roomId]},{...hourly('second',50),scope:'rooms',roomIds:[roomId]}]});
 expect(()=>useHub.getState().publishCompensationRule('first','2026-10')).toThrow(/直播间.*占用/);
 expect(useHub.getState().compensationTasks).toEqual([]);
 expect(useHub.getState().compensationRules.every(r=>r.status==='草稿')).toBe(true);
});
it('does not publish a reassigned room until the previous published owner releases it',()=>{
 const s=useHub.getState(),roomId=s.rooms[0].id,newRoom={...s.rooms[0],id:'second-room'};
 useHub.setState({rooms:[...s.rooms,newRoom]});
 publish({...allowance('owner'),scope:'rooms',roomIds:[roomId]});
 useHub.getState().saveCompensationRule({...useHub.getState().compensationRules[0],roomIds:[newRoom.id]});
 useHub.getState().saveCompensationRule({...hourly('replacement',50),scope:'rooms',roomIds:[roomId]});
 expect(()=>useHub.getState().publishCompensationRule('replacement','2026-10')).toThrow(/直播间.*占用/);
 expect(useHub.getState().publishedCompensationRules).toHaveLength(1);
 useHub.getState().publishCompensationRule('owner');
 useHub.getState().publishCompensationRule('replacement','2026-10');
 expect(useHub.getState().publishedCompensationRules).toHaveLength(2);
 expect(useHub.getState().compensationTasks).toEqual([]);
});

it('logically deletes a draft while releasing its room for a replacement rule',()=>{
 const s=useHub.getState(),roomId=s.rooms[0].id;
 s.saveCompensationRule({...allowance('owner'),scope:'rooms',roomIds:[roomId]});
 const original=structuredClone(useHub.getState().compensationRules[0]);
 useHub.getState().deleteCompensationRule('owner');
 const deleted=useHub.getState().compensationRules[0];
 expect(deleted).toMatchObject(original);expect(deleted.deletedAt).toEqual(expect.any(String));
 expect(useHub.getState().compensationTasks).toEqual([]);
 useHub.getState().saveCompensationRule({...hourly('replacement',50),scope:'rooms',roomIds:[roomId]});
 expect(useHub.getState().compensationRules.filter(rule=>!rule.deletedAt).map(rule=>rule.id)).toEqual(['replacement']);
});
it('deleting a rule atomically withdraws its pending tasks across open months and keeps task snapshots',()=>{
 publish(allowance('remove'));publish(allowance('keep'));loadLegacyPendingInputs();
 const s=useHub.getState(),task=structuredClone(s.compensationTasks[0]);
 const nextMonth={...task,id:'next-month',month:'2026-11',referenceDate:'2026-11-30'};
 const withdrawn={...task,id:'withdrawn',status:'已撤回' as const,withdrawnAt:'2026-10-01 12:00:00'};
 useHub.setState({compensationTasks:[task,nextMonth,withdrawn,s.compensationTasks[1]]});
 const observed:{deleted:boolean;pending:number}[]=[];
 const unsubscribe=useHub.subscribe(state=>observed.push({deleted:!!state.compensationRules.find(rule=>rule.id==='remove')?.deletedAt,pending:state.compensationTasks.filter(item=>item.ruleId==='remove'&&item.status==='待核算').length}));
 try{useHub.getState().deleteCompensationRule('remove');}finally{unsubscribe();}
 const after=useHub.getState(),deletedAt=after.compensationRules[0].deletedAt;
 expect(observed).toEqual([{deleted:true,pending:0}]);
 expect(after.compensationTasks[0]).toEqual({...task,status:'已撤回',withdrawnAt:deletedAt});
 expect(after.compensationTasks[1]).toEqual({...nextMonth,status:'已撤回',withdrawnAt:deletedAt});
 expect(after.compensationTasks[2]).toEqual(withdrawn);expect(after.compensationTasks[3]).toEqual(s.compensationTasks[1]);
 expect(after.compensationRules[1]).toEqual(s.compensationRules[1]);expect(after.batch).toBeNull();
});
it('deleting a rule preserves completed archived tasks and frozen payroll while withdrawing later pending tasks',()=>{
 publish(allowance());useHub.getState().runPayroll();archiveCurrentMonth();
 const s=useHub.getState(),frozen=structuredClone(s.batch),task=structuredClone(s.compensationTasks[0]);
 const withdrawn={...task,id:'archived-withdrawn',status:'已撤回' as const,withdrawnAt:'2026-10-01 12:00:00'};
 useHub.setState({compensationTasks:[task,withdrawn,{...task,id:'future-pending',month:'2026-11',referenceDate:'2026-11-30',status:'待核算'}]});
 useHub.getState().deleteCompensationRule('allow');
 const after=useHub.getState();
 expect(after.compensationTasks[0]).toEqual(task);expect(after.compensationTasks[1]).toEqual(withdrawn);
 expect(after.compensationTasks[2]).toMatchObject({status:'已撤回',withdrawnAt:after.compensationRules[0].deletedAt});
 expect(after.batch).toEqual(frozen);expect(after.batches['2026-10']).toEqual(frozen);expect(after.archivedMonths).toEqual(['2026-10']);
});
it('rejects deletion with an anomalous archived pending task before changing any business state',()=>{
 publish(allowance());loadLegacyPendingInputs();const task=structuredClone(useHub.getState().compensationTasks[0]);
 useHub.setState({archivedMonths:['2026-09'],compensationTasks:[task,{...task,id:'archived-pending',month:'2026-09'}]});
 const before=structuredClone(useHub.persist.getOptions().partialize!(useHub.getState()));
 expect(()=>useHub.getState().deleteCompensationRule('allow')).toThrow('归档');
 expect(useHub.persist.getOptions().partialize!(useHub.getState())).toEqual(before);
});
it('rejects missing and repeated deletion and stale save or publish without resurrecting a deleted rule',()=>{
 publish(allowance());loadLegacyPendingInputs();const stale=structuredClone(useHub.getState().compensationRules[0]);
 useHub.getState().deleteCompensationRule('allow');
 const before=structuredClone(useHub.persist.getOptions().partialize!(useHub.getState()));
 expect(()=>useHub.getState().deleteCompensationRule('missing')).toThrow('不存在');
 expect(()=>useHub.getState().deleteCompensationRule('allow')).toThrow('已删除');
 expect(()=>useHub.getState().saveCompensationRule({...stale,name:'旧窗口保存'})).toThrow('已删除');
 expect(()=>useHub.getState().publishCompensationRule('allow','2026-10')).toThrow('已删除');
 expect(useHub.persist.getOptions().partialize!(useHub.getState())).toEqual(before);
});
it('rehydrates logically deleted rules and withdrawn tasks without adding starter rules or allowing stale save',()=>{
 publish(allowance());loadLegacyPendingInputs();const stale=structuredClone(useHub.getState().compensationRules[0]);
 useHub.getState().deleteCompensationRule('allow');
 const options=useHub.persist.getOptions(),saved=JSON.parse(JSON.stringify(options.partialize!(useHub.getState())));
 useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});
 const restored=options.merge!(saved,useHub.getState());useHub.setState(restored);
 expect(restored.compensationRules).toEqual(saved.compensationRules);expect(restored.compensationRules).toHaveLength(1);
 expect(restored.compensationRules[0].deletedAt).toEqual(expect.any(String));
 expect(restored.compensationTasks).toEqual(saved.compensationTasks);expect(restored.compensationTasks[0].status).toBe('已撤回');
 expect(()=>useHub.getState().saveCompensationRule(stale)).toThrow('已删除');
});

it('rejects premium creation and publication while preserving the stored state on failure',()=>{
 const premium:CompensationRule={id:'disabled-premium',name:'旧保费系数',version:1,status:'草稿',scope:'global',roomIds:[],type:'premium',premium:{items:[{id:'p',name:'总保费',field:'premium',coefficient:2}]}};
 const s=useHub.getState();
 expect(()=>s.saveCompensationRule(premium)).toThrow(/保费系数.*停用/);
 expect(useHub.getState().compensationRules).toEqual([]);
 useHub.setState({compensationRules:[premium]});
 expect(()=>s.publishCompensationRule(premium.id)).toThrow(/保费系数.*停用/);
 expect(useHub.getState().publishedCompensationRules).toEqual([]);
 useHub.setState({publishedCompensationRules:[{...premium,status:'已发布'}]});
 expect(()=>s.runPayroll()).toThrow(/保费系数.*停用/);expect(useHub.getState().batch).toBeNull();
});
