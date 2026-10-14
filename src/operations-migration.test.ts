import { afterEach, expect, it } from 'vitest';
import { createJSONStorage } from 'zustand/middleware';
import { migrateOperationsState } from './operations-migration';
import { useHub } from './store';

const legacy = () => ({
 month:'2026-10',revision:7,syncTime:'custom sync',
 employees:['host','buyer','control'].map(id=>({id,name:`自定义${id}`,departmentId:'live',position:'主播',joined:'2026-01-01',status:'在职',phone:'',email:'',identities:[],role:'员工'})),
 departments:[{id:'live',name:'自定义直播部',active:true}],roles:[{id:'custom',name:'自定义角色',permissions:['来源']}],
 projects:[{id:'old',name:'自定义产品',code:'CUSTOM',platform:'巨量引擎',account:'AD001',active:true,liveAccountIds:['ROOM001','ROOM002'],access:{appId:'CUSTOMAPP',secretConfigured:true,authCodeConfigured:true,secret:'must-drop',authCode:'must-drop'}}],
 liveRecords:[{id:'custom-record',projectId:'old',date:'2026-10-01',start:'02:00',end:'03:00',hostId:'host',buyerId:'buyer',controlId:'control',version:8}],
 adHours:[{id:'custom-ad',projectId:'old',date:'2026-10-01',start:'02:00',end:'03:00',spend:123,payment:246,impressions:100,clicks:20,conversions:10,conversionCost:12.3,conversionRate:.5,orders:10}],
 roomHours:['ROOM001','ROOM002'].map((accountId,index)=>({id:`custom-room-${index}`,projectId:'old',accountId,date:'2026-10-01',start:'02:00',end:'03:00',spend:100+index*100,revenue:200+index*200,clicks:20,clickRate:.2,clickCost:5,conversions:10,conversionRate:.5,conversionCost:10,roi:2,orders:10,viewers:100,fans:5,tips:0})),
 departmentRules:[{id:'custom-rule',name:'修改过的规则',departmentId:'live',version:5,status:'草稿',projectIds:['old'],metrics:[{id:'hours',field:'hours',rate:63,bands:[]}],expression:['hours'],sourceNote:'custom source'}],
 rules:[],scheme:{name:'old scheme'},payrollTasks:[{id:'old-task'}],batch:{month:'2026-09'},batches:{'2026-09':{month:'2026-09'}},archivedMonths:['2026-09'],
 dataset:{rows:[{old:true}],month:'2026-10',version:9,revision:7,published:true},liveDetails:[{old:true}],monthlyRows:[{old:true}],
});
const originalStorage=useHub.persist.getOptions().storage;
afterEach(()=>{useHub.persist.setOptions({storage:originalStorage});useHub.getState().reset();});

it('旧运营关系一次性升级，保留自定义资料、来源与规则并仅清空核算归档',()=>{
 const old=legacy(),copy=structuredClone(old),state=migrateOperationsState(old) as unknown as ReturnType<typeof useHub.getState>;
 expect(old).toEqual(copy);
 expect(state.employees).toEqual(old.employees);expect(state.departments).toEqual(old.departments);expect(state.roles).toEqual(old.roles);expect(state.syncTime).toBe(old.syncTime);
 expect(state.products[0]).toMatchObject({id:'product-old',name:'自定义产品',platform:'巨量引擎',accountId:'AD001'});
 expect(state.products[0].access).toEqual({appId:'CUSTOMAPP',secretConfigured:true,authCodeConfigured:true});
 expect(JSON.stringify(state)).not.toContain('must-drop');
 expect(state.rooms.map(r=>[r.id,r.platformAccountId])).toEqual([['old','ROOM001'],['old-room-2','ROOM002']]);
 expect(state.liveRecords).toEqual([{...old.liveRecords[0],projectId:undefined,productId:'product-old',roomId:'old'}]);
 expect(state.liveRecords).toHaveLength(1);expect(state.liveRecords[0].version).toBe(8);
 expect(state.adHours).toEqual([{...old.adHours[0],projectId:undefined,productId:'product-old',roomId:'old'}]);
 expect(state.roomHours.map(r=>[r.id,r.roomId,r.spend])).toEqual([['custom-room-0','old',100],['custom-room-1','old-room-2',200]]);
 expect(state.departmentRules[0]).toEqual({...old.departmentRules[0],projectIds:undefined,roomIds:['old']});
 expect(state.monthlyRows).toHaveLength(3);expect(state.monthlyRows.every(r=>r.spend===100 && r.roomId==='old')).toBe(true);
 expect(state.liveDetails[0]).toMatchObject({productName:'自定义产品',roomName:'自定义产品直播间',spend:100});
 expect(state.dataset).toMatchObject({version:10,revision:8,published:true});expect(state.revision).toBe(8);
 expect(state.payrollTasks).toEqual([]);expect(state.batch).toBeNull();expect(state.batches).toEqual({});expect(state.archivedMonths).toEqual([]);
 for(const key of ['projects','rules','scheme']) expect(state).not.toHaveProperty(key);
});
it('缺小时来源时保留每条原始数据并清除旧派生统计，标记待重新统计',()=>{
 const old=legacy();old.roomHours=old.roomHours.filter(r=>r.accountId==='ROOM002');
 const state=migrateOperationsState(old) as unknown as ReturnType<typeof useHub.getState>;
 expect(state.liveRecords).toHaveLength(1);expect(state.roomHours).toHaveLength(1);expect(state.adHours).toHaveLength(1);
 expect(state.monthlyRows).toEqual([]);expect(state.liveDetails).toEqual([]);expect(state.dataset).toMatchObject({rows:[],published:false,revision:-1});
});
it('实际旧版本持久化重载完成迁移，再次原生重载保留新核算任务及归档',async()=>{
 const key=useHub.persist.getOptions().name,contents=new Map([[key,JSON.stringify({state:legacy(),version:0})]]);
 const storage=createJSONStorage(()=>({getItem:(id:string)=>contents.get(id)??null,setItem:(id:string,value:string)=>{contents.set(id,value);},removeItem:(id:string)=>{contents.delete(id);}}));
 useHub.persist.setOptions({storage});await useHub.persist.rehydrate();
 const state=useHub.getState();expect(state.products[0].name).toBe('自定义产品');expect(state.liveRecords[0].version).toBe(8);expect(state.roomHours).toHaveLength(2);expect(state.payrollTasks).toEqual([]);
 expect(JSON.parse(contents.get(key)!).version).toBe(1);
 state.publishDepartmentRule('custom-rule','2026-10');state.runPayroll();
 const tasks=structuredClone(useHub.getState().payrollTasks),batch=structuredClone(useHub.getState().batch);
 expect(tasks).toHaveLength(1);expect(batch?.salaries[0].total).toBe(63);
 await useHub.persist.rehydrate();
 expect(useHub.getState().payrollTasks).toEqual(tasks);expect(useHub.getState().batch).toEqual(batch);expect(useHub.getState().archivedMonths).toEqual(['2026-10']);
 expect(useHub.getState().products[0].name).toBe('自定义产品');
});
it('原生迁移帮助函数幂等，不重复清空已产生的新任务和工资',()=>{
 const migrated=migrateOperationsState(legacy());const state={...migrated,payrollTasks:[{id:'new-task'}],batch:{month:'2026-10'},batches:{'2026-10':{month:'2026-10'}},archivedMonths:['2026-10']};
 expect(migrateOperationsState(state)).toEqual(state);
});
