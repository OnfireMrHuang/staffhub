import { describe, expect, it } from 'vitest';
import type { Department, Employee } from './domain';
import { buildLiveStatistics, generateLiveTemplate, validateLiveRecord, type LiveRecord, type RoomHourly } from './live-domain';
const departments:Department[]=[{id:'d',name:'直播部',active:true}];
const employees:Employee[]=Array.from({length:6},(_,i)=>({id:`e${i}`,name:`员工${i}`,departmentId:'d',position:'主播',joined:'',status:'在职',phone:'',email:'',identities:[],role:'员工'}));
const products:AdvertisingProduct[]=[{id:'product-p',name:'产品',accountId:'投放账户',platform:'巨量营销',active:true}];
const liveRooms:LiveRoom[]=[{id:'p',name:'直播间',platformAccountId:'a',productId:'product-p',active:true}];
const record=(patch:Partial<LiveRecord>={}):LiveRecord=>({id:'r',roomId:'p',productId:'product-p',date:'2026-10-01',start:'02:00',end:'08:00',hostId:'e0',buyerId:'e1',controlId:'e2',version:1,...patch});
const room=(hour:number,accountId='a',patch:Partial<RoomHourly>={}):RoomHourly=>({id:`${accountId}-${hour}`,roomId:'p',productId:'product-p',accountId,date:'2026-10-01',start:`${String(hour).padStart(2,'0')}:00`,end:`${String(hour+1).padStart(2,'0')}:00`,spend:100,revenue:200,clicks:20,clickRate:.2,clickRateDenominator:100,clickCost:5,conversions:2,conversionRate:.1,conversionRateDenominator:20,conversionCost:50,roi:2,orders:2,viewers:100,fans:3,tips:10,...patch});
const rooms=()=>Array.from({length:6},(_,i)=>[room(i+2)]).flat();
const build=(records=[record()],source=rooms())=>buildLiveStatistics(records,source,employees,departments,liveRooms,products,'2026-10');
describe('直播模板和校验',()=>{
 it('为两个项目生成48行整小时全天模板',()=>{const rows=generateLiveTemplate(['p','q'],'2026-10-01','00:00','24:00',60);expect(rows).toHaveLength(48);expect(rows.at(-1)).toEqual({roomId:'q',date:'2026-10-01',start:'23:00',end:'24:00'});});
 it.each([30,90,0])('拒绝非整小时模板分片 %s',step=>expect(()=>generateLiveTemplate(['p'],'2026-10-01','00:00','24:00',step)).toThrow(/整小时/));
 it('末段截止于指定结束时间且仍保持整小时',()=>expect(generateLiveTemplate(['p'],'2026-10-01','00:00','08:00',180)).toEqual([{roomId:'p',date:'2026-10-01',start:'00:00',end:'03:00'},{roomId:'p',date:'2026-10-01',start:'03:00',end:'06:00'},{roomId:'p',date:'2026-10-01',start:'06:00',end:'08:00'}]));
 it('拒绝不存在的日历日期和重复项目',()=>{expect(()=>generateLiveTemplate(['p'],'2026-02-30','00:00','24:00',60)).toThrow(/日期/);expect(()=>generateLiveTemplate(['p','p'],'2026-10-01','00:00','24:00',60)).toThrow(/重复/);});
 it('允许同人兼岗整小时记录',()=>expect(()=>validateLiveRecord(record({buyerId:'e0'}),employees,liveRooms,products,[],[])).not.toThrow());
 it('拒绝非整小时和无效员工ID',()=>{expect(()=>validateLiveRecord(record({start:'02:30'}),employees,liveRooms,products,[],[])).toThrow(/整小时/);expect(()=>validateLiveRecord(record({controlId:'missing'}),employees,liveRooms,products,[],[])).toThrow(/员工/);});
 it('拒绝归档月份修改以及项目时间重叠',()=>{expect(()=>validateLiveRecord(record(),employees,liveRooms,products,[],['2026-10'])).toThrow(/归档/);expect(()=>validateLiveRecord(record({id:'next',start:'07:00'}),employees,liveRooms,products,[record()],[])).toThrow(/重叠/);});
 it('允许首尾相接和更新自身',()=>{expect(()=>validateLiveRecord(record({id:'next',start:'08:00',end:'09:00'}),employees,liveRooms,products,[record()],[])).not.toThrow();expect(()=>validateLiveRecord(record(),employees,liveRooms,products,[record()],[])).not.toThrow();});
});
describe('直播业务统计',()=>{
 it('以直播间多账户小时汇总三岗位，保费等于成交额',()=>{const {details,monthly}=build();expect(details).toHaveLength(1);expect(details[0]).toMatchObject({spend:600,revenue:1200,roi:2,hostName:'员工0',buyerName:'员工1',controlName:'员工2'});expect(monthly).toHaveLength(3);expect(monthly[0]).toMatchObject({hours:6,spend:600,premium:1200,roi:2,hourlySpend:100,year:2026,roles:['主播'],hostNames:['员工0']});});
 it('精确处理夜班2-6和早班6-8边界',()=>{expect(build().monthly[0]).toMatchObject({nightHours:4,earlyHours:2,nightSpend:400,earlySpend:200,sessions:1,nightSessions:1,earlySessions:1});});
 it('同人兼三个岗位仅有一行一次贡献',()=>{const rows=build([record({buyerId:'e0',controlId:'e0'})]).monthly;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({hours:6,spend:600,premium:1200,roles:['主播','投手','场控']});});
 it('连续同人员组合合并场次，间隔和换人产生新场次',()=>{const records=[record({end:'04:00'}),record({id:'r2',start:'04:00',end:'06:00'}),record({id:'r3',start:'07:00',end:'08:00'})];expect(build(records).monthly[0]).toMatchObject({hours:5,sessions:2,nightSessions:1,earlySessions:1});const changed=records.map(r=>r.id==='r2'?{...r,buyerId:'e3'}:r);expect(build(changed).monthly[0].sessions).toBe(3);});
 it('跨日首尾相接的同组合只有一场',()=>{const records=[record({date:'2026-10-01',start:'23:00',end:'24:00'}),record({id:'r2',date:'2026-10-02',start:'00:00',end:'01:00'})];const source=['a'].flatMap(a=>[room(23,a),room(0,a,{id:`${a}-day2`,date:'2026-10-02'})]);expect(build(records,source).monthly[0]).toMatchObject({hours:2,sessions:1});});
 it('ROI在同项目同月竞争排名并保留并列名次',()=>{const records=[record({end:'04:00'}),record({id:'r2',start:'04:00',hostId:'e3',buyerId:'e4',controlId:'e5'})];const source=rooms().map(r=>Number(r.start.slice(0,2))<4?{...r,revenue:400}:r);const monthly=build(records,source).monthly;expect(monthly.find(r=>r.employeeId==='e0')?.roiRank).toBe(1);expect(monthly.find(r=>r.employeeId==='e3')?.roiRank).toBe(4);});
 it('缺任一账户小时即阻断而非默认零',()=>expect(()=>build([record()],rooms().filter(r=>r.id!=='a-4'))).toThrow(/缺少.*小时/));
 it('拒绝重复源小时和重复记录ID及项目重叠',()=>{expect(()=>build([record()],[...rooms(),room(2)])).toThrow(/重复/);expect(()=>build([record(),record()])).toThrow(/重复/);expect(()=>build([record(),record({id:'r2'})])).toThrow(/重叠/);});
 it('拒绝非小时源和不属于项目的直播账户',()=>{expect(()=>build([record()],rooms().map((r,i)=>i? r:{...r,end:'04:00'}))).toThrow(/小时/);expect(()=>build([record()],[...rooms(),room(2,'unlinked')])).toThrow(/账户/);});
 it('零消耗及负数来源无法静默生成有效ROI',()=>{expect(()=>build([record()],rooms().map(r=>({...r,spend:0})))).toThrow(/消耗/);expect(()=>build([record()],rooms().map((r,i)=>i?r:{...r,revenue:-1}))).toThrow(/无效/);});
 it('仅统计所选月份，跨月连续场次仍去重',()=>{const records=[record({date:'2026-09-30',start:'23:00',end:'24:00'}),record({id:'r2',date:'2026-10-01',start:'00:00',end:'02:00'})];const source=['a'].flatMap(a=>[room(0,a),room(1,a)]);const result=build(records,source);expect(result.details).toHaveLength(1);expect(result.monthly[0]).toMatchObject({hours:2,sessions:1});});
});

import { demoAdHours, demoMonth, demoProducts, demoRooms, demoRecords, demoRoomHours, demoProjects } from './live-seed';
import { seedEmployees, seedDepartments } from './real-seed';
import { fillSimulatedHours } from './live-sync';
import { splitLegacyProjects, type AdvertisingProduct, type LiveRoom } from './operations-domain';
it('2点以前和8点以后均不计入夜早班，汇总比率从合计值重算',()=>{
 const records=[record({start:'01:00',end:'09:00'})];
 const source=Array.from({length:8},(_,i)=>[room(i+1,'a',{roi:999,clickRate:999,conversionRate:999,clickCost:999,conversionCost:999})]).flat();
 const result=build(records,source);
 expect(result.monthly[0]).toMatchObject({hours:8,nightHours:4,earlyHours:2,spend:800,nightSpend:400,earlySpend:200});
 expect(result.details[0]).toMatchObject({roi:2,clickRate:.2,conversionRate:.1,clickCost:5,conversionCost:50});
});
it('旧归档记录不能改到未归档月，24点仅允许作为结束时间',()=>{
 expect(()=>validateLiveRecord(record({date:'2026-11-01'}),employees,liveRooms,products,[record()],['2026-10'])).toThrow(/归档/);
 expect(()=>generateLiveTemplate(['p'],'2026-10-01','24:00','24:00',60)).toThrow(/整小时/);
 expect(()=>generateLiveTemplate(['p'],'2026-10-01','00:00','25:00',60)).toThrow(/整小时/);
});
it('同产品的不同直播间分别计时和排名',()=>{
 const second={...liveRooms[0],id:'q',name:'第二直播间',platformAccountId:'b'};
 const records=[record(),record({id:'q-record',roomId:'q'})];
 const source=[...rooms(),...rooms().map(r=>({...r,id:`q-${r.id}`,roomId:'q',accountId:'b',revenue:10000}))];
 const monthly=buildLiveStatistics(records,source,employees,departments,[...liveRooms,second],products,'2026-10').monthly;
 expect(monthly).toHaveLength(6);
 expect(monthly.filter(r=>r.employeeId==='e0')).toHaveLength(2);
 expect(monthly.every(r=>r.hours===6&&r.roiRank===1)).toBe(true);
 expect(monthly.find(r=>r.roomId==='p')?.spend).toBe(600);
 expect(monthly.every(r=>r.productId==='product-p')).toBe(true);
});
it('直播记录和来源均拒绝产品与直播间归属不一致',()=>{
 expect(()=>validateLiveRecord(record({productId:'wrong'}),employees,liveRooms,products,[],[])).toThrow(/产品|归属/);
 expect(()=>build([record()],rooms().map((r,i)=>i?r:{...r,productId:'wrong'}))).toThrow(/产品|归属/);
});
it('历史停用产品和直播间仍能生成统计',()=>{
 expect(buildLiveStatistics([record()],rooms(),employees,departments,liveRooms.map(r=>({...r,active:false})),products.map(p=>({...p,active:false})),'2026-10').monthly[0].hours).toBe(6);
});
it('模拟产品使用三平台枚举',()=>expect(demoProducts.map(p=>p.platform)).toEqual(['巨量引擎','磁力引擎','腾讯 ADQ']));
it('跨小时率仅使用明确营销分母，不猜观看人次',()=>{
 const explicit=rooms().map(r=>({...r,viewers:9999,clickRateDenominator:200,conversionRateDenominator:40}));
 expect(build([record()],explicit).details[0]).toMatchObject({clickRate:.1,conversionRate:.05});
 const missing=explicit.map((r,i)=>i?r:{...r,clickRateDenominator:undefined,conversionRateDenominator:undefined});
 expect(build([record()],missing).details[0]).toMatchObject({clickRate:null,conversionRate:null});
});
it('单来源可以保留原平台率，零分母成本和率未定义',()=>{
 const singleRoom=[liveRooms[0]];
 const one=room(2,'a',{clickRate:.37,conversionRate:.23,clickRateDenominator:undefined,conversionRateDenominator:undefined});
 const single=buildLiveStatistics([record({end:'03:00'})],[one],employees,departments,singleRoom,products,'2026-10');
 expect(single.details[0]).toMatchObject({clickRate:.37,conversionRate:.23});
 const zero=rooms().map(r=>({...r,clicks:0,conversions:0,clickRateDenominator:0,conversionRateDenominator:0}));
 expect(build([record()],zero).details[0]).toMatchObject({clickRate:null,conversionRate:null,clickCost:null,conversionCost:null});
});
it('旧项目拆分保留名称和四个来源账户，直播记录只迁至主直播间',()=>{
 const {products: migratedProducts,rooms: migratedRooms}=splitLegacyProjects(demoProjects);
 expect(migratedProducts).toEqual(demoProducts);
 expect(migratedRooms).toEqual(demoRooms);
 expect(migratedRooms).toHaveLength(4);
 expect(migratedProducts.map(p=>p.name)).toEqual(demoProjects.map(p=>p.name));
 expect(migratedRooms.map(r=>r.platformAccountId).sort()).toEqual(demoProjects.flatMap(p=>p.liveAccountIds).sort());
 expect(demoRecords).toHaveLength(30);
 expect(demoRecords.every(r=>demoProjects.some(p=>p.id===r.roomId))).toBe(true);
 const result=buildLiveStatistics(demoRecords,demoRoomHours,seedEmployees,seedDepartments,demoRooms,demoProducts,demoMonth);
 expect(result.monthly.some(r=>r.roles.length>1)).toBe(true);
});
it('两天模拟来源按产品/直播间完整采集24小时，空小时有明确零测量记录',()=>{
 for(const liveRoom of demoRooms)for(const date of ['2026-10-01','2026-10-02']){
  const ad=demoAdHours.filter(r=>r.roomId===liveRoom.id&&r.date===date);
  const day=demoRoomHours.filter(r=>r.roomId===liveRoom.id&&r.date===date);
  expect(ad).toHaveLength(24);expect(day).toHaveLength(24);
  expect(day.every(r=>r.productId===liveRoom.productId&&r.accountId===liveRoom.platformAccountId)).toBe(true);
  expect(new Set(day.map(r=>r.start)).size).toBe(24);
  expect(day.find(r=>r.start==='00:00')).toMatchObject({spend:0,revenue:0,clicks:0,conversions:0,orders:0,viewers:0,fans:0,tips:0});
 }
});
it('模拟同步按产品和直播间小时补齐，保留既有来源并且幂等',()=>{
 const input={month:demoMonth,products:demoProducts,rooms:demoRooms,records:demoRecords,adHours:[demoAdHours[0]],roomHours:[demoRoomHours[0]]};
 const first=fillSimulatedHours(input);
 expect(first.adHours).toHaveLength(192);expect(first.roomHours).toHaveLength(192);
 expect(first.adHours[0]).toEqual(input.adHours[0]);
 expect(first.roomHours[0]).toEqual(input.roomHours[0]);
 const again=fillSimulatedHours({...input,...first});
 expect(again.addedAdHours).toBe(0);expect(again.addedRoomHours).toBe(0);
 expect(new Set(first.adHours.map(r=>JSON.stringify([r.productId,r.roomId,r.date,r.start]))).size).toBe(192);
});
