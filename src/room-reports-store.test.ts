import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import { monthlyRowKey } from './dataset-corrections';
const archiveCurrentMonth = () => { useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});const s=useHub.getState();s.archivePayroll(s.month,s.batch!.review!.version); };
beforeEach(()=>{useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});});
const save=(period:'hourly'|'daily',key:string,patch:Record<string,unknown>,reason='平台对账')=>useHub.getState().saveReportCorrection(period,key,patch,reason,useHub.getState().dataset.version);
it('hour → day → month corrections survive refresh with independent monthly final authority',()=>{
 const s=useHub.getState(),hour=s.reportHours[0],day=s.reportDays.find(d=>d.key===hour.dailyKey)!,original=s.monthlyRows.find(r=>r.roomId===hour.roomId&&r.employeeId===hour.hostId)!;
 save('hourly',hour.key,{spend:hour.spend+100});
 expect(useHub.getState().reportDays.find(d=>d.key===day.key)!.spend).toBe(day.spend+100);
 expect(useHub.getState().monthlyRows.find(r=>monthlyRowKey(r)===monthlyRowKey(original))!.spend).toBe(original.spend+100);
 const current=useHub.getState().reportDays.find(d=>d.key===day.key)!;
 save('daily',day.key,{spend:current.spend+200});
 expect(useHub.getState().monthlyRows.find(r=>monthlyRowKey(r)===monthlyRowKey(original))!.spend).toBeCloseTo(original.spend+300);
 useHub.getState().saveDatasetCorrection('monthly',monthlyRowKey(original),{spend:99999},'月度独立对账',useHub.getState().dataset.version);
 save('hourly',hour.key,{revenue:hour.revenue+1000});
 useHub.getState().cleanDataset();
 expect(useHub.getState().monthlyRows.find(r=>monthlyRowKey(r)===monthlyRowKey(original))!.spend).toBe(99999);
 expect(useHub.getState().roomHours).toEqual(s.roomHours);expect(useHub.getState().reportAudit).toHaveLength(3);
});
it('reason/version/archive/derived/grain guards reject atomically and restore keeps history',()=>{
 const s=useHub.getState(),hour=s.reportHours[0],version=s.dataset.version;
 expect(()=>save('hourly',hour.key,{spend:1},' ')).toThrow('原因');
 expect(()=>save('hourly',hour.key,{roi:5})).toThrow('只读');
 expect(()=>save('hourly',hour.key,{date:'2026-11-01'})).toThrow('只读');
 expect(()=>save('hourly',hour.key,{spend:hour.spend})).toThrow('没有修改');
 save('hourly',hour.key,{spend:1});
 expect(()=>useHub.getState().saveReportCorrection('hourly',hour.key,{spend:2},'旧页',version)).toThrow('版本');
 useHub.getState().restoreReportCorrection('hourly',hour.key,'取消小时修订',useHub.getState().dataset.version);
 expect(useHub.getState().reportHours.find(h=>h.key===hour.key)!.spend).toBe(hour.spend);expect(useHub.getState().reportAudit).toHaveLength(2);
 useHub.setState({archivedMonths:[s.month]});
 expect(()=>save('hourly',hour.key,{spend:1})).toThrow('归档');
 expect(useHub.getState().reportOverrides).toEqual([]);
});
it('snapshots freeze report values/definitions/audit and old archives do not synthesize reports',()=>{
 const s=useHub.getState(),hour=s.reportHours[0];save('hourly',hour.key,{spend:hour.spend+10});
 const rule=useHub.getState().departmentRules[0];useHub.getState().publishDepartmentRule(rule.id,s.month);useHub.getState().runPayroll();archiveCurrentMonth();
 const snapshot=useHub.getState().batch!.snapshot;
 expect(snapshot.roomReports!.contributions.length).toBeGreaterThan(0);expect(snapshot.roomReports!.hourly[0].spend).toBe(hour.spend+10);expect(snapshot.roomReports!.definitions).toHaveLength(2);expect(snapshot.roomReports!.audit).toHaveLength(1);
 const saved=structuredClone(snapshot.roomReports);useHub.setState({reportHours:[],reportDays:[]});useHub.getState().setMonth('2026-11');useHub.getState().setMonth(s.month);
 expect(useHub.getState().reportHours).toEqual(saved!.hourly);
 const batch=structuredClone(useHub.getState().batch!);delete batch.snapshot.roomReports;useHub.setState({batches:{[s.month]:batch}});useHub.getState().setMonth('2026-11');useHub.getState().setMonth(s.month);
 expect(useHub.getState().reportHours).toEqual([]);expect(useHub.getState().monthlyRows).toEqual(batch.snapshot.monthly);
});
it('rehydration keeps report overrides and audit without changing persistence key/version',async()=>{
 const original=useHub.persist.getOptions().storage,s=useHub.getState(),hour=s.reportHours[0];save('hourly',hour.key,{spend:321});
 const {reportOverrides,reportAudit}=useHub.getState();
 const memory=new Map<string,unknown>();useHub.persist.setOptions({storage:{getItem:name=>memory.get(name) as never,setItem:(name,value)=>{memory.set(name,value);},removeItem:name=>{memory.delete(name);}}});
 useHub.setState({reportOverrides,reportAudit});useHub.setState({reportOverrides:[],reportAudit:[]});
 // Reinsert the captured persisted state, simulating another process loading it.
 const persisted=memory.get('meimei-staffhub-department-rules-v1') as {state:object;version:number};memory.set('meimei-staffhub-department-rules-v1',{...persisted,state:{...persisted.state,reportOverrides,reportAudit}});
 await useHub.persist.rehydrate();useHub.getState().cleanDataset();expect(useHub.getState().reportHours.find(h=>h.key===hour.key)!.spend).toBe(321);expect(useHub.getState().reportAudit).toHaveLength(1);expect(useHub.persist.getOptions().version).toBe(1);
 useHub.persist.setOptions({storage:original});
});
it('hourly team reassignment updates live daily duration beneath a fixed daily amount override',()=>{
 const s=useHub.getState(),hour=s.reportHours[0],day=s.reportDays.find(d=>d.key===hour.dailyKey)!;
 save('daily',day.key,{spend:day.spend+100});
 save('hourly',hour.key,{hostId:hour.buyerId});
 const current=useHub.getState().reportDays.find(d=>d.key===day.key)!;
 expect(current.hours).toBe(day.hours-1);expect(current.spend).toBe(day.spend+100);
 const replacement=useHub.getState().reportDays.find(d=>d.date===hour.date&&d.roomId===hour.roomId&&d.hostId===hour.buyerId)!;
 expect(replacement.hours).toBe(1);
});
it('unbound historical rooms keep explicit monthly compatibility and cannot edit an undefined report',()=>{
 const s=useHub.getState(),room=s.rooms[0],record=s.liveRecords.find(r=>r.roomId===room.id)!,newRoom={...room,id:'unbound-room',platformAccountId:'unbound-account',name:'未绑定自定义房间'};
 useHub.setState({rooms:[...s.rooms,newRoom],liveRecords:[...s.liveRecords,{...record,id:'unbound-record',roomId:newRoom.id}],roomHours:[...s.roomHours,...s.roomHours.filter(h=>h.roomId===room.id&&h.date===record.date&&h.start>=record.start&&h.end<=record.end).map(h=>({...h,id:`copy-${h.id}`,roomId:newRoom.id,accountId:newRoom.platformAccountId}))],revision:s.revision+1});
 useHub.getState().cleanDataset();const hour=useHub.getState().reportHours.find(h=>h.roomId===newRoom.id)!;
 expect(useHub.getState().monthlyRows.some(r=>r.roomId===newRoom.id)).toBe(true);
 expect(()=>save('hourly',hour.key,{spend:1})).toThrow('未绑定');
});
it('raw identity changes under hourly and daily overlays reject atomically; restore unlocks input',()=>{
 for(const period of ['hourly','daily'] as const){
  useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});const s=useHub.getState(),row=(period==='hourly'?s.reportHours:s.reportDays)[0],record=s.liveRecords.find(r=>r.id===row.sourceRecordId||row.sourceRecordIds.includes(r.id)||row.sourceRecordIds.some(key=>key.includes(r.id)))!;
  save(period,row.key,{spend:row.spend+10});const before=useHub.getState(),original=structuredClone(before.liveRecords);
  expect(()=>before.saveLiveRecords([{...record,hostId:record.buyerId,version:record.version+1}])).toThrow('先恢复');
  expect(useHub.getState().liveRecords).toEqual(original);expect(useHub.getState().revision).toBe(before.revision);expect(useHub.getState().reportAudit).toEqual(before.reportAudit);
  before.restoreReportCorrection(period,row.key,'来源人员调整前恢复',before.dataset.version);
  useHub.getState().saveLiveRecords([{...record,hostId:record.buyerId,version:record.version+1}]);
  expect(useHub.getState().liveRecords.find(r=>r.id===record.id)!.hostId).toBe(record.buyerId);
 }
});
it('report overlay guard allows unrelated new raw rows before hourly sync',()=>{
 const s=useHub.getState(),hour=s.reportHours[0],record=s.liveRecords.find(r=>r.id===hour.sourceRecordId)!;
 save('hourly',hour.key,{spend:hour.spend+10});
 const inserted={...record,id:'new-unsynced-record',date:'2026-10-03'};
 useHub.getState().saveLiveRecords([inserted]);
 expect(useHub.getState().liveRecords).toContainEqual(inserted);expect(useHub.getState().reportOverrides).toHaveLength(1);
});
it('archive freezes recomputed hour/day/month ratios after layered corrections',()=>{
 const s=useHub.getState(),hour=s.reportHours[0];save('hourly',hour.key,{spend:2000,revenue:6000});
 const day=useHub.getState().reportDays.find(d=>d.key===hour.dailyKey)!;save('daily',day.key,{revenue:40000});
 const rule=useHub.getState().departmentRules[0];useHub.getState().publishDepartmentRule(rule.id,s.month);useHub.getState().runPayroll();archiveCurrentMonth();
 const snapshot=useHub.getState().batch!.snapshot,frozenHour=snapshot.roomReports!.hourly.find(h=>h.key===hour.key)!,frozenDay=snapshot.roomReports!.daily.find(d=>d.key===day.key)!,monthly=snapshot.monthly.find(r=>r.employeeId===hour.hostId&&r.roomId===hour.roomId)!;
 expect(frozenHour.roi).toBe(3);expect(frozenDay.roi).toBe(40000/day.spend);expect(monthly.roi).toBe(monthly.premium/monthly.spend);
 useHub.setState({roomHours:s.roomHours.map(row=>({...row,spend:1,revenue:999,roi:999})),reportHours:[],reportDays:[]});
 useHub.getState().setMonth('2026-11');useHub.getState().setMonth(s.month);
 expect(useHub.getState().reportHours.find(h=>h.key===hour.key)!.roi).toBe(3);expect(useHub.getState().reportDays.find(d=>d.key===day.key)!.roi).toBe(frozenDay.roi);expect(useHub.getState().monthlyRows).toEqual(snapshot.monthly);
});
