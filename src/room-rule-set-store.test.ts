import { scheduleTestMonth, loadLegacyPendingInputs } from './payroll-test-fixtures';
import {beforeEach,expect,it} from 'vitest';
import {useHub,type CompensationTask} from './store';
import type {CompensationRule} from './compensation-rules';
import {listRoomRuleSets,type RoomRuleSet} from './room-rule-sets';
import {createCompensationRule,withType} from './pages/compensation-definition';
import {prepareRoomRuleSetDraft} from './pages/RoomRuleSetEditor';
const archiveCurrentMonth = () => { useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});const s=useHub.getState();s.archivePayroll(s.month,s.batch!.review!.version); };

const member=(id:string,type:CompensationRule['type'],roomIds=[useHub.getState().rooms[0].id]):CompensationRule=>({id,name:id,version:1,status:'草稿',scope:'rooms',roomIds,type,...(type==='allowance'?{allowance:{field:'nightSessions' as const,amount:20}}:type==='premium'?{premium:{items:[{id:'p',name:'正常保费',field:'regularPremium' as const,coefficient:1.5}]}}:{hourly:{duration:'hours' as const,items:[{id:'h',name:'ROI 加成',kind:'metric' as const,field:'roi',bands:[{keyType:'range' as const,min:12,includeMin:true,includeMax:false,rate:50}]}],formula:{mode:'additions' as const,itemIds:['h']}}})});
const draft=(types:CompensationRule['type'][]=['allowance','hourly','premium'],id='set'):RoomRuleSet=>({id,roomIds:[useHub.getState().rooms[0].id],rules:types.map(type=>member(`${id}-${type}`,type))});
const saved=()=>listRoomRuleSets(useHub.getState().compensationRules)[0];
const business=()=>structuredClone(useHub.persist.getOptions().partialize!(useHub.getState()));
const publish=()=>{useHub.getState().saveRoomRuleSet(draft());useHub.getState().publishRoomRuleSet('set','2026-10');};

beforeEach(()=>{
 useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});
 const s=useHub.getState(),employee={...s.employees[0],status:'在职' as const},room=s.rooms[0],product=s.products.find(item=>item.id===room.productId)!;
 const row={...s.dataset.rows.find(item=>item.roomId===room.id)!,employeeId:employee.id,employeeName:employee.name,departmentId:employee.departmentId,roomId:room.id,productId:product.id,month:'2026-10',hours:10,nightHours:2,earlyHours:3,regularHours:5,premium:1000,nightPremium:0,earlyPremium:200,regularPremium:800,spend:100,roi:10,hourlySpend:10,sessions:4,nightSessions:2,earlySessions:2,roiRank:1};
 useHub.setState({employees:[employee],rooms:[room],products:[product],liveRecords:[],roomHours:[],adHours:[],dataset:{rows:[row],month:'2026-10',revision:1,version:1,published:true},monthlyRows:[row],revision:1,compensationRules:[],compensationTasks:[],payrollTasks:[]});
});
beforeEach(scheduleTestMonth);

it('saves three different rule types in one atomic draft with common version and room scope',()=>{
 const events:number[]=[];const unsubscribe=useHub.subscribe(s=>events.push(s.compensationRules.length));
 try{useHub.getState().saveRoomRuleSet(draft());}finally{unsubscribe();}
 expect(events).toEqual([3]);expect(saved().rules.map(rule=>[rule.type,rule.version,rule.status,rule.roomRuleSetId])).toEqual([['allowance',1,'草稿','set'],['hourly',1,'草稿','set'],['premium',1,'草稿','set']]);
 const edit=saved();edit.rules[0]={...edit.rules[0],name:'修改补贴'};useHub.getState().saveRoomRuleSet(edit);
 expect(saved().rules.map(rule=>rule.version)).toEqual([2,2,2]);expect(saved().rules[0].name).toBe('修改补贴');
});

it('saves version-zero rules produced by the editor for new groups and legacy additions',()=>{
 const roomIds=[useHub.getState().rooms[0].id];
 const fresh={...createCompensationRule('rooms'),name:'新补贴'};
 expect(fresh.version).toBe(0);
 useHub.getState().saveRoomRuleSet(prepareRoomRuleSetDraft({id:'new-set',roomIds,rules:[fresh]}));
 expect(saved().rules[0]).toMatchObject({version:1,status:'草稿',roomRuleSetId:'new-set'});
 useHub.getState().deleteRoomRuleSet('new-set');
 useHub.getState().saveCompensationRule(member('legacy','allowance'));
 const premium={...withType(createCompensationRule('rooms'),'premium'),name:'新系数'};
 useHub.getState().saveRoomRuleSet(prepareRoomRuleSetDraft({...saved(),rules:[...saved().rules,premium]}));
 expect(saved().id).toBe('legacy');expect(saved().rules.map(rule=>[rule.type,rule.version])).toEqual([['allowance',2],['premium',2]]);
});

it('rejects duplicate types, invalid members, and other groups owning any room without partial mutation',()=>{
 useHub.getState().saveRoomRuleSet(draft(['allowance']));const before=business();
 const duplicates=draft(['allowance','allowance'],'other');duplicates.rules[1].id='unique-id';
 const invalid=draft(['hourly','premium'],'other');invalid.rules[1].premium={items:[]};
 for(const value of [duplicates,invalid,draft(['hourly'],'other')]){expect(()=>useHub.getState().saveRoomRuleSet(value)).toThrow();expect(business()).toEqual(before);}
});

it('does not capture existing child IDs or assign foreign membership through a group save',()=>{
 useHub.getState().saveRoomRuleSet(draft(['allowance']));const before=business(),roomId=useHub.getState().rooms[0].id;
 const attacks:RoomRuleSet[]=[{id:'other',roomIds:[roomId],rules:saved().rules},{id:'set',roomIds:[roomId],rules:[{...member('new','premium'),roomRuleSetId:'foreign'}]},{id:'set-allowance',roomIds:[roomId],rules:[member('new','premium')]}];
 for(const attack of attacks){expect(()=>useHub.getState().saveRoomRuleSet(attack)).toThrow(/归属|规则集|占用/);expect(business()).toEqual(before);}
 useHub.getState().saveCompensationRule({...member('global','allowance'),scope:'global',roomIds:[]});
 expect(()=>useHub.getState().saveRoomRuleSet({id:'set',roomIds:[roomId],rules:[member('global','allowance')]})).toThrow(/分类|归属/);
});

it('blocks direct child mutations while preserving the legacy singleton save and group conversion',()=>{
 const legacy=member('legacy','allowance');useHub.getState().saveCompensationRule(legacy);
 expect(saved().id).toBe('legacy');expect(saved().rules[0].roomRuleSetId).toBeUndefined();
 useHub.getState().saveRoomRuleSet({...saved(),rules:[...saved().rules,member('premium','premium')]});
 const child=saved().rules[0],before=business();
 expect(saved().rules.every(rule=>rule.roomRuleSetId==='legacy'&&rule.version===2)).toBe(true);
 expect(()=>useHub.getState().saveCompensationRule(child)).toThrow(/规则集/);
 expect(()=>useHub.getState().deleteCompensationRule(child.id)).toThrow(/规则集/);
 expect(()=>useHub.getState().publishCompensationRule(child.id,'2026-10')).toThrow(/规则集/);
 expect(business()).toEqual(before);
});

it('publishes all three members atomically and applies coefficient, hourly rate and allowance in payroll',()=>{
 useHub.getState().saveRoomRuleSet(draft());const observed:number[]=[];const unsubscribe=useHub.subscribe(s=>observed.push(s.publishedCompensationRules.length));
 try{useHub.getState().publishRoomRuleSet('set','2026-10');}finally{unsubscribe();}
 expect(observed).toEqual([3]);expect(useHub.getState().compensationTasks).toEqual([]);
 useHub.getState().runPayroll();const tasks=useHub.getState().compensationTasks;
 expect(tasks.every(task=>task.status==='已核算'&&task.roomRuleSet?.id==='set'&&task.roomRuleSet.version===1)).toBe(true);
 expect(tasks[0].roomRuleSet?.ruleIds).toEqual(['set-allowance','set-hourly','set-premium']);
 expect(tasks.every(task=>JSON.stringify(task.roomRuleSet)===JSON.stringify(tasks[0].roomRuleSet))).toBe(true);
 expect(()=>useHub.getState().publishRoomRuleSet('set','2026-10')).toThrow(/重复/);
 expect(useHub.getState().batch?.salaries[0].total).toBe(540);
 expect(useHub.getState().batch?.compensationResult?.rows[0].premium.after).toBe(1200);
 expect(useHub.getState().compensationTasks.every(task=>task.status==='已核算')).toBe(true);
});

it('keeps frozen group publication when editing definitions and calculates from those snapshots',()=>{
 publish();const definitions=structuredClone(useHub.getState().publishedCompensationRules),edit=saved();
 edit.rules=edit.rules.map(rule=>rule.type==='allowance'?{...rule,allowance:{field:'nightSessions',amount:999}}:rule);useHub.getState().saveRoomRuleSet(edit);
 expect(useHub.getState().publishedCompensationRules).toEqual(definitions);expect(saved().rules.every(rule=>rule.version===2)).toBe(true);
 useHub.getState().runPayroll();expect(useHub.getState().batch?.salaries[0].total).toBe(540);
});

it('new draft members do not change the frozen membership of an existing publication',()=>{
 useHub.getState().saveRoomRuleSet(draft(['allowance','premium']));useHub.getState().publishRoomRuleSet('set','2026-10');
 const definitions=structuredClone(useHub.getState().publishedCompensationRules),edit=saved();edit.rules.push(member('set-hourly','hourly'));
 useHub.getState().saveRoomRuleSet(edit);expect(useHub.getState().publishedCompensationRules).toEqual(definitions);
 useHub.getState().runPayroll();expect(useHub.getState().batch?.salaries[0].total).toBe(40);expect(useHub.getState().batch?.snapshot.compensationTasks).toHaveLength(2);
 useHub.getState().publishRoomRuleSet('set');useHub.getState().runPayroll(0);expect(useHub.getState().batch?.salaries[0].total).toBe(540);
});

it('new groups cannot adopt existing members from a different group even in unoccupied rooms',()=>{
 useHub.getState().saveRoomRuleSet(draft(['allowance']));const s=useHub.getState(),nextRoom={...s.rooms[0],id:'next-room'};useHub.setState({rooms:[...s.rooms,nextRoom]});
 const before=business(),foreign={...member('set-allowance','allowance',[nextRoom.id]),roomRuleSetId:'other'};
 expect(()=>useHub.getState().saveRoomRuleSet({id:'other',roomIds:[nextRoom.id],rules:[foreign]})).toThrow(/归属/);expect(business()).toEqual(before);
 expect(()=>useHub.getState().saveCompensationRule({...foreign,id:'set',roomRuleSetId:undefined})).toThrow(/规则集/);expect(business()).toEqual(before);
});

it('rejects an invalid second child or broken current group before creating any tasks',()=>{
 useHub.getState().saveRoomRuleSet(draft());const valid=structuredClone(useHub.getState().compensationRules);
 for(const rules of [valid.map(rule=>rule.type==='premium'?{...rule,premium:{items:[]}}:rule),valid.map(rule=>rule.type==='hourly'?{...rule,version:2}:rule),[valid[0],{...valid[1],type:'allowance' as const,hourly:undefined,allowance:{field:'nightSessions' as const,amount:20}}]]){
  useHub.setState({compensationRules:rules});const before=business();expect(()=>useHub.getState().publishRoomRuleSet('set','2026-10')).toThrow();expect(business()).toEqual(before);
 }
});

it('rejects legacy missing members, mixed publication metadata and versions before any payroll transition',()=>{
 publish();loadLegacyPendingInputs();const tasks=structuredClone(useHub.getState().compensationTasks);
 const variants:CompensationTask[][]=[tasks.slice(1),tasks.map((task,index)=>index===1?{...task,roomRuleSet:{...task.roomRuleSet!,version:2}}:task),tasks.map((task,index)=>index===1?{...task,roomRuleSet:undefined}:task),tasks.map((task,index)=>index===1?{...task,roomRuleSet:{...task.roomRuleSet!,ruleIds:[task.ruleId]}}:task),tasks.map((task,index)=>index===1?{...task,roomRuleSet:{...task.roomRuleSet!,publicationId:'different'}}:task)];
 for(const compensationTasks of variants){useHub.setState({compensationTasks});const before=business();expect(()=>useHub.getState().runPayroll()).toThrow(/规则集|成员|版本/);expect(business()).toEqual(before);}
});

it('withdraws every pending member in the selected group/month with one observable state change',()=>{
 publish();loadLegacyPendingInputs();const tasks=structuredClone(useHub.getState().compensationTasks);const future=tasks.map(task=>({...task,id:`future-${task.id}`,month:'2026-11'}));useHub.setState({compensationTasks:[...tasks,...future]});
 const events:string[][]=[];const unsubscribe=useHub.subscribe(s=>events.push(s.compensationTasks.map(task=>task.status)));
 try{useHub.getState().withdrawCompensationTask(tasks[1].id);}finally{unsubscribe();}
 expect(events).toEqual([['已撤回','已撤回','已撤回','待核算','待核算','待核算']]);
 expect(useHub.getState().compensationTasks.slice(0,3).every(task=>task.withdrawnAt===useHub.getState().compensationTasks[0].withdrawnAt)).toBe(true);
 expect(useHub.getState().compensationTasks.filter(task=>task.month==='2026-10'&&task.status==='待核算')).toHaveLength(0);
});

it('removing a draft member preserves the complete published set until republication',()=>{
 publish();const definitions=structuredClone(useHub.getState().publishedCompensationRules),edit=saved();edit.rules=edit.rules.filter(rule=>rule.type!=='premium');
 useHub.getState().saveRoomRuleSet(edit);
 expect(saved().rules.map(rule=>[rule.type,rule.version])).toEqual([['allowance',2],['hourly',2]]);
 expect(useHub.getState().compensationRules.find(rule=>rule.type==='premium')?.deletedAt).toEqual(expect.any(String));
 expect(useHub.getState().publishedCompensationRules).toEqual(definitions);
 useHub.getState().publishRoomRuleSet('set');
 expect(useHub.getState().publishedCompensationRules.map(rule=>rule.type)).toEqual(['allowance','hourly']);
});

it('blocks member removal and group deletion atomically if any pending related month is archived',()=>{
 publish();loadLegacyPendingInputs();const task=useHub.getState().compensationTasks[0];useHub.setState({compensationTasks:[...useHub.getState().compensationTasks,{...task,id:'archived-pending',month:'2026-09'}],archivedMonths:['2026-09']});const before=business();
 expect(()=>useHub.getState().saveRoomRuleSet({...saved(),rules:saved().rules.slice(0,1)})).toThrow(/归档/);expect(business()).toEqual(before);
 expect(()=>useHub.getState().deleteRoomRuleSet('set')).toThrow(/归档/);expect(business()).toEqual(before);
});

it('deletes all group members, withdraws pending across months and releases rooms without changing historical payroll',()=>{
 publish();useHub.getState().runPayroll();archiveCurrentMonth();const frozen=structuredClone(useHub.getState().batch),completed=structuredClone(useHub.getState().compensationTasks);
 useHub.setState({compensationTasks:[...completed,...completed.map(task=>({...task,id:`future-${task.id}`,month:'2026-11',status:'待核算' as const}))]});
 useHub.getState().deleteRoomRuleSet('set');
 expect(listRoomRuleSets(useHub.getState().compensationRules)).toEqual([]);expect(useHub.getState().compensationRules.every(rule=>!!rule.deletedAt)).toBe(true);
 expect(useHub.getState().compensationTasks.slice(0,3)).toEqual(completed);expect(useHub.getState().compensationTasks.slice(3).every(task=>task.status==='已撤回')).toBe(true);expect(useHub.getState().batch).toEqual(frozen);
 useHub.getState().saveRoomRuleSet(draft(['allowance'],'replacement'));expect(saved().id).toBe('replacement');
 expect(()=>useHub.getState().saveRoomRuleSet(draft())).toThrow(/已删除/);expect(()=>useHub.getState().publishRoomRuleSet('set','2026-10')).toThrow();
});

it('reassigned rooms are available to drafts but their previous published owner must release them',()=>{
 publish();const s=useHub.getState(),room=s.rooms[0],next={...room,id:'next-room'};useHub.setState({rooms:[room,next]});
 const edit=saved();edit.roomIds=[next.id];edit.rules=edit.rules.map(rule=>({...rule,roomIds:[next.id]}));useHub.getState().saveRoomRuleSet(edit);
 useHub.getState().saveRoomRuleSet(draft(['allowance'],'replacement'));const before=business();expect(()=>useHub.getState().publishRoomRuleSet('replacement','2026-10')).toThrow(/直播间.*占用/);expect(business()).toEqual(before);
 useHub.getState().publishRoomRuleSet('set');useHub.getState().publishRoomRuleSet('replacement');
 expect(useHub.getState().publishedCompensationRules).toHaveLength(4);
 expect(useHub.getState().compensationTasks).toEqual([]);
});
