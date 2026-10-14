import { describe, expect, it } from 'vitest';
import type { Department, Employee } from './domain';
import { buildLiveStatistics, type LiveDetail, type LiveMonthly, type LiveRecord, type RoomHourly } from './live-domain';
import type { AdvertisingProduct, LiveRoom } from './operations-domain';
import { applyDatasetCorrections, monthlyRowKey, prepareDetailCorrection, prepareMonthlyCorrection, type DetailOverride, type MonthlyOverride } from './dataset-corrections';

const departments: Department[] = [{id:'live',name:'直播部',active:true},{id:'ads',name:'投放部',active:true}];
const employees: Employee[] = Array.from({length:6},(_,i)=>({id:`e${i}`,name:`员工${i}`,departmentId:'live',position:'主播',joined:'2026-01-01',status:'在职',phone:'',email:'',identities:[],role:'员工'}));
const products: AdvertisingProduct[] = [{id:'p',name:'产品一',accountId:'a',platform:'巨量营销',active:true},{id:'q',name:'产品二',accountId:'b',platform:'腾讯广告',active:true}];
const rooms: LiveRoom[] = [{id:'r',name:'直播间一',platformAccountId:'a',productId:'p',active:true},{id:'s',name:'直播间二',platformAccountId:'b',productId:'q',active:true}];
const record = (patch: Partial<LiveRecord>={}): LiveRecord => ({id:'source',roomId:'r',productId:'p',date:'2026-10-01',start:'02:00',end:'08:00',hostId:'e0',buyerId:'e1',controlId:'e2',version:1,...patch});
const hour = (h:number): RoomHourly => ({id:`h${h}`,roomId:'r',productId:'p',accountId:'a',date:'2026-10-01',start:`0${h}:00`,end:`0${h+1}:00`,spend:h<6?25:200,revenue:200,clicks:20,clickRate:.2,clickRateDenominator:100,clickCost:5,conversions:2,conversionRate:.1,conversionRateDenominator:20,conversionCost:50,roi:2,orders:2,viewers:100,fans:3,tips:10});
const stats = ()=>buildLiveStatistics([record()],Array.from({length:6},(_,i)=>hour(i+2)),employees,departments,rooms,products,'2026-10');
const detail = (patch:Partial<LiveDetail>={}):LiveDetail=>({...stats().details[0],...patch});
const monthly = (patch:Partial<LiveMonthly>={}):LiveMonthly=>({...stats().monthly[0],...patch});
const editDetail = (patch:Record<string,unknown>, row=detail(), staff=employees)=>prepareDetailCorrection(row,patch,staff,rooms,products);
const editMonthly = (patch:Record<string,unknown>, row=monthly())=>prepareMonthlyCorrection(row,patch,employees,departments,rooms,products);
const apply = (detailOverrides:DetailOverride[]=[], monthlyOverrides:MonthlyOverride[]=[], month='2026-10', baseDetails=[detail()], contextRecords=[record()])=>applyDatasetCorrections(baseDetails,detailOverrides,monthlyOverrides,employees,departments,rooms,products,month,contextRecords);
const override = (row:LiveDetail):DetailOverride=>({key:'source',sourceMonth:'2026-10',row});
const monthOverride = (row:LiveMonthly,key=monthlyRowKey(monthly())):MonthlyOverride=>({key,sourceMonth:'2026-10',row});

describe('明细人工纠正',()=>{
  it('自动重算比率及单价，保留内部指标，消耗按真实来源班次占比分配',()=>{
    const row=editDetail({spend:1000,revenue:1500,clicks:60,conversions:24});
    expect(row).toMatchObject({roi:1.5,clickCost:1000/60,conversionCost:1000/24,clickRate:.1,conversionRate:.2,nightSpend:200,earlySpend:800,fans:18,tips:60});
    expect(detail().spend).toBe(500);
  });
  it('调整时段后按新夜早班时长占比重分总消耗',()=>{
    expect(editDetail({start:'04:00',end:'10:00',spend:600})).toMatchObject({nightSpend:200,earlySpend:200});
  });
  it.each(['roi','clickRate','clickCost','conversionRate','conversionCost','nightSpend','fans','id','hostName'])('拒绝修改只读字段 %s',field=>{
    expect(()=>editDetail({[field]:1})).toThrow(/只读|不支持/);
  });
  it('零分母为未定义，缺少营销分母不会猜测观看人数',()=>{
    expect(editDetail({spend:0,clicks:0,conversions:0})).toMatchObject({roi:null,clickCost:null,conversionCost:null});
    expect(editDetail({clicks:12},detail({clickRateDenominator:undefined})).clickRate).toBeNull();
    expect(editDetail({conversions:12},detail({conversionRateDenominator:0})).conversionRate).toBeNull();
  });
  it.each([{spend:-1},{spend:NaN},{revenue:Infinity},{clicks:1.5},{orders:-1},{viewers:'1'},{date:'2026-02-30'},{start:'02:30'},{end:'02:00'},{roomId:'missing'},{roomId:'s'},{hostId:'missing'}])('拒绝无效基础指标或关联 %j',patch=>expect(()=>editDetail(patch)).toThrow());
  it('关联变化时要求在职并检查真实入职日期，历史数字修正不受当前离职影响',()=>{
    const off=employees.map(e=>({...e,status:'已离职' as const}));
    expect(()=>editDetail({spend:700},detail(),off)).not.toThrow();
    expect(()=>editDetail({hostId:'e3'},detail(),off)).toThrow(/在职/);
    expect(()=>editDetail({date:'2025-12-31'})).toThrow(/入职/);
    const invalidJoined=employees.map(e=>({...e,joined:'2026-02-30'}));
    expect(()=>editDetail({date:'2026-10-02'},detail(),invalidJoined)).toThrow(/入职日期/);
  });
  it('三岗与直播间移动移除旧归属，同人兼岗只贡献一次',()=>{
    const row=editDetail({hostId:'e3',buyerId:'e3',controlId:'e3',roomId:'s',productId:'q'});
    const result=apply([override(row)]);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toMatchObject({roomName:'直播间二',productName:'产品二',hostName:'员工3',buyerName:'员工3',controlName:'员工3'});
    expect(result.monthly).toHaveLength(1);
    expect(result.monthly[0]).toMatchObject({employeeId:'e3',roomId:'s',hours:6,spend:500,premium:1200,roles:['主播','投手','场控']});
  });
  it('跨月移动整行替换，原月移除且目标月只插入一次',()=>{
    const row=editDetail({date:'2026-11-01'}), changes=[override(row)];
    expect(apply(changes).details).toHaveLength(0);
    expect(apply(changes).monthly).toHaveLength(0);
    const target=apply(changes,[],'2026-11',[]);
    expect(target.details).toHaveLength(1);
    expect(target.monthly[0]).toMatchObject({month:'2026-11',hours:6,spend:500});
    expect(apply(changes,[],'2026-11',[row]).details).toHaveLength(1);
  });
  it('有效记录重叠拒绝，已移出原时段的覆盖不会误阻断',()=>{
    const other=record({id:'other',start:'08:00',end:'10:00'});
    expect(()=>apply([override(editDetail({start:'07:00',end:'09:00'}))],[],'2026-10',[detail()],[record(),other])).toThrow(/重叠/);
    const moved=editDetail({start:'10:00',end:'12:00'});
    const otherDetail=detail({...other,spend:100,revenue:200,nightSpend:0,earlySpend:0});
    expect(()=>apply([override(moved)],[],'2026-10',[detail(),otherDetail],[record(),other])).not.toThrow();
  });
  it('从全部有效连续记录重建场次，换岗切断原先连续组合',()=>{
    const next=detail({id:'next',start:'08:00',end:'10:00',spend:100,revenue:200,nightSpend:0,earlySpend:0});
    const result=apply([override(editDetail({hostId:'e3'}))],[],'2026-10',[detail(),next],[record(),next]);
    expect(result.monthly.find(r=>r.employeeId==='e1')).toMatchObject({hours:8,sessions:2});
  });
  it('跨月上下文保留午夜连续场次，目标月多段只计一个场次',()=>{
    const prior=record({id:'prior',date:'2026-09-30',start:'23:00',end:'24:00'});
    const a=detail({start:'00:00',end:'01:00',nightSpend:0,earlySpend:0});
    const b=detail({id:'next',start:'01:00',end:'02:00',nightSpend:0,earlySpend:0});
    const result=apply([],[],'2026-10',[a,b],[prior,a,b]);
    expect(result.monthly[0]).toMatchObject({hours:2,sessions:1,nightSessions:0});
  });
});

describe('月度人工纠正',()=>{
  it('关联名称自动带出，允许独立部门归属并重算年、ROI与时耗',()=>{
    const row=editMonthly({employeeId:'e3',departmentId:'ads',roomId:'s',productId:'q',month:'2027-01',hours:20,spend:1000,premium:1500,hostNames:['员工1','员工3']});
    expect(row).toMatchObject({employeeName:'员工3',departmentId:'ads',departmentName:'投放部',roomName:'直播间二',productName:'产品二',year:2027,roi:1.5,hourlySpend:50,hostNames:['员工1','员工3']});
    expect(employees[3].departmentId).toBe('live');
  });
  it.each(['roi','hourlySpend','roiRank','year','roles','employeeName','departmentName'])('拒绝只读月度字段 %s',field=>expect(()=>editMonthly({[field]:1})).toThrow(/只读|不支持/));
  it.each([{hours:-1},{spend:NaN},{nightHours:5,earlyHours:3},{nightSpend:200,earlySpend:400},{sessions:1.5},{sessions:0,nightSessions:1},{hostNames:['不存在']},{hostNames:['员工0','员工0']},{month:'2026-13'},{employeeId:'missing'},{departmentId:'missing'},{roomId:'s'}])('拒绝月度无效总量、班次或关联 %j',patch=>expect(()=>editMonthly(patch)).toThrow());
  it('夜早场次可来自同一场，不要求两班次之和小于总场次',()=>{
    expect(editMonthly({sessions:1,nightSessions:1,earlySessions:1})).toMatchObject({sessions:1,nightSessions:1,earlySessions:1});
  });
  it('月度跨月改键移除原粒度，目标月插入并重新排名',()=>{
    const row=editMonthly({employeeId:'e3',month:'2026-11',spend:600,premium:1800});
    const changes=[monthOverride(row)];
    expect(apply([],changes).monthly.map(r=>r.employeeId)).toEqual(['e1','e2']);
    const target=apply([],changes,'2026-11',[]);
    expect(target.monthly).toHaveLength(1);
    expect(target.monthly[0]).toMatchObject({employeeId:'e3',month:'2026-11',roi:3,roiRank:1});
  });
  it('改键撞上现有员工直播间月份时拒绝，原键覆盖允许',()=>{
    expect(()=>apply([],[monthOverride(editMonthly({employeeId:'e1'}))])).toThrow(/粒度|重复|冲突/);
    expect(apply([],[monthOverride(editMonthly({premium:500}))]).monthly.find(r=>r.employeeId==='e0')).toMatchObject({roi:1,roiRank:3});
  });
  it('先重建明细再叠加月度值，全部有效行最后统一排名，零分母排除',()=>{
    const result=apply([override(editDetail({spend:1000}))],[monthOverride(editMonthly({spend:0,nightSpend:0,earlySpend:0}))]);
    expect(result.monthly.find(r=>r.employeeId==='e0')).toMatchObject({roi:null,roiRank:null});
    expect(result.monthly.find(r=>r.employeeId==='e1')).toMatchObject({spend:1000,roi:1.2,roiRank:1});
    const zero=editMonthly({hours:0,nightHours:0,earlyHours:0,spend:0,nightSpend:0,earlySpend:0});
    expect(zero).toMatchObject({roi:null,hourlySpend:null,roiRank:null});
  });
});

it('有限大金额分配先计算占比，避免中间乘法溢出',()=>{
  const row=detail({spend:1e300,nightSpend:2e299,earlySpend:8e299});
  const scaled=editDetail({spend:2e300},row);expect(scaled.nightSpend! / 1e300).toBeCloseTo(.4);expect(scaled.earlySpend! / 1e300).toBeCloseTo(1.6);
  expect(editDetail({start:'04:00',end:'10:00',spend:6e300},row)).toMatchObject({nightSpend:2e300,earlySpend:2e300});
});
it('覆盖中的原键不能重复或与行ID不一致',()=>{
  expect(()=>apply([override(detail()),override(detail())])).toThrow(/重复/);
  expect(()=>apply([{...override(detail()),key:'wrong'}])).toThrow(/原键/);
  expect(()=>apply([],[{...monthOverride(monthly()),sourceMonth:'2026-09'}])).toThrow(/原键|原月份/);
});
