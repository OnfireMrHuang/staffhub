import { expect, it } from 'vitest';
import { buildRoomReports, getRoomReportDefinition, prepareReportCorrection, applyReportOverrides } from './room-reports';
import { demoRecords, demoRoomHours, demoRooms, demoProducts } from './live-seed';
import { seedEmployees, seedDepartments } from './seed';
import { buildLiveStatistics, summarizeLiveDetails } from './live-domain';

const build=()=>buildRoomReports(demoRecords,demoRoomHours,seedEmployees,seedDepartments,demoRooms,demoProducts,'2026-10',[]);
it('explicit sample bindings share two real schemas; unknown room has no fallback',()=>{
 expect(getRoomReportDefinition(demoRooms[0].id)).toBe(getRoomReportDefinition(demoRooms[1].id));
 expect(getRoomReportDefinition(demoRooms[0].id)?.fields.map(f=>f.key)).not.toEqual(getRoomReportDefinition(demoRooms[2].id)?.fields.map(f=>f.key));
 expect(getRoomReportDefinition('new-room')).toBeUndefined();
});
it('hours preserve exact measured hourly values; daily ratios recompute and monthly grain is unchanged',()=>{
 const report=build(); expect(report.hourly).toHaveLength(60);
 const hour=report.hourly[0], source=demoRoomHours.find(h=>h.roomId===hour.roomId&&h.date===hour.date&&h.start===hour.start)!;
 expect(hour.spend).toBe(source.spend);expect(Number(hour.end.slice(0,2))-Number(hour.start.slice(0,2))).toBe(1);
 const day=report.daily[0], hours=report.hourly.filter(h=>h.dailyKey===day.key);
 expect(day.spend).toBe(hours.reduce((n,h)=>n+h.spend,0));expect(day.roi).toBe(day.revenue/day.spend);
 const expected=buildLiveStatistics(demoRecords,demoRoomHours,seedEmployees,seedDepartments,demoRooms,demoProducts,'2026-10').monthly;
 const monthly=summarizeLiveDetails(report.contributions,seedEmployees,seedDepartments,'2026-10',demoRecords);
 expect(monthly).toEqual(expected);
});
it('hourly override flows through daily and monthly with same-person dual roles deduplicated',()=>{
 const base=build(), hour=base.hourly.find(h=>h.hostId===h.buyerId)!;
 const after=prepareReportCorrection(hour,{spend:hour.spend+100,revenue:hour.revenue+500},seedEmployees,demoRooms,demoProducts);
 const report=applyReportOverrides(base,[{period:'hourly',key:hour.key,sourceMonth:'2026-10',row:after}],seedEmployees,seedDepartments,demoRecords);
 expect(report.daily.find(d=>d.key===hour.dailyKey)!.spend).toBe(base.daily.find(d=>d.key===hour.dailyKey)!.spend+100);
 const rows=summarizeLiveDetails(report.contributions,seedEmployees,seedDepartments,'2026-10',demoRecords);
 const before=summarizeLiveDetails(base.contributions,seedEmployees,seedDepartments,'2026-10',demoRecords).find(r=>r.roomId===hour.roomId&&r.employeeId===hour.hostId)!;
 expect(rows.find(r=>r.roomId===hour.roomId&&r.employeeId===hour.hostId)!.spend).toBe(before.spend+100);
});
it('daily override changes amounts but preserves real hour shifts and continuous session counting',()=>{
 const base=build(),day=base.daily[0],after=prepareReportCorrection(day,{spend:day.spend*2,revenue:day.revenue*3},seedEmployees,demoRooms,demoProducts);
 const report=applyReportOverrides(base,[{period:'daily',key:day.key,sourceMonth:'2026-10',row:after}],seedEmployees,seedDepartments,demoRecords);
 const before=summarizeLiveDetails(base.contributions,seedEmployees,seedDepartments,'2026-10',demoRecords),rows=summarizeLiveDetails(report.contributions,seedEmployees,seedDepartments,'2026-10',demoRecords);
 const old=before.find(r=>r.employeeId===day.hostId&&r.roomId===day.roomId)!,row=rows.find(r=>r.employeeId===day.hostId&&r.roomId===day.roomId)!;
 expect(row.spend).toBeCloseTo(old.spend+day.spend);expect(row.nightSpend).toBeCloseTo(old.nightSpend+(day.nightSpend??0));
 expect(row.hours).toBe(old.hours);expect(row.sessions).toBe(old.sessions);expect(row.nightSessions).toBe(old.nightSessions);
});
it('legacy multi-hour overrides stay effective without inventing hourly measurements',()=>{
 const raw=buildLiveStatistics(demoRecords,demoRoomHours,seedEmployees,seedDepartments,demoRooms,demoProducts,'2026-10').details[0];
 const reports=buildRoomReports(demoRecords,demoRoomHours,seedEmployees,seedDepartments,demoRooms,demoProducts,'2026-10',[{key:raw.id,sourceMonth:'2026-10',row:{...raw,spend:9999}}]);
 expect(reports.hourly.filter(h=>h.sourceRecordId===raw.id).every(h=>h.legacyOverride)).toBe(true);
 expect(reports.contributions.find(h=>h.id===raw.id)!.spend).toBe(9999);
 expect(reports.hourly.find(h=>h.sourceRecordId===raw.id)!.spend).toBe(build().hourly.find(h=>h.sourceRecordId===raw.id)!.spend);
 expect(()=>prepareReportCorrection(reports.hourly.find(h=>h.sourceRecordId===raw.id)!,{spend:1},seedEmployees,demoRooms,demoProducts)).toThrow('历史');
});
it('derived values and grain are read-only and missing denominators stay undefined',()=>{
 const hour=build().hourly[0];
 expect(()=>prepareReportCorrection(hour,{roi:99},seedEmployees,demoRooms,demoProducts)).toThrow('只读');
 expect(()=>prepareReportCorrection(hour,{start:'02:30'},seedEmployees,demoRooms,demoProducts)).toThrow('只读');
 const next=prepareReportCorrection({...hour,clickRateDenominator:undefined},{spend:0,clicks:0},seedEmployees,demoRooms,demoProducts);
 expect(next.roi).toBeNull();expect(next.clickRate).toBeNull();expect(next.clickCost).toBeNull();
});
it('audience tips preserve raw count semantics and reject fractional correction',()=>{
 const row=build().hourly.find(h=>getRoomReportDefinition(h.roomId)!.id==='demo-audience')!;
 expect(getRoomReportDefinition(row.roomId)!.fields.find(f=>f.key==='tips')).toMatchObject({label:'打赏次数',type:'非负整数'});
 expect(()=>prepareReportCorrection(row,{tips:1.5},seedEmployees,demoRooms,demoProducts)).toThrow('整数');
});
const nativeRateReports=(count:number)=>{
 const record={...demoRecords[0],end:count===1?'03:00':'04:00'};
 const source=demoRoomHours.filter(h=>h.roomId===record.roomId&&h.date===record.date&&h.start>=record.start&&h.end<=record.end).map(h=>({...h,clickRate:0.17,conversionRate:0.12,clickRateDenominator:undefined,conversionRateDenominator:undefined}));
 return buildRoomReports([record],source,seedEmployees,seedDepartments,demoRooms,demoProducts,'2026-10',[]);
};
it('native hourly and single-hour daily platform rates survive missing optional denominators',()=>{
 const reports=nativeRateReports(1);
 expect(reports.hourly[0]).toMatchObject({clickRate:0.17,conversionRate:0.12});
 expect(reports.daily[0]).toMatchObject({clickRate:0.17,conversionRate:0.12});
 const unchanged=prepareReportCorrection(reports.hourly[0],{spend:2000},seedEmployees,demoRooms,demoProducts);
 expect(unchanged).toMatchObject({clickRate:0.17,conversionRate:0.12});
 const overlaid=applyReportOverrides(reports,[{period:'hourly',key:unchanged.key,sourceMonth:'2026-10',row:unchanged}],seedEmployees,seedDepartments,[]);
 expect(overlaid.hourly[0]).toMatchObject({clickRate:0.17,conversionRate:0.12});expect(overlaid.daily[0]).toMatchObject({clickRate:0.17,conversionRate:0.12});
 const daily=prepareReportCorrection(reports.daily[0],{revenue:6000},seedEmployees,demoRooms,demoProducts);
 const dailyOverlay=applyReportOverrides(reports,[{period:'daily',key:daily.key,sourceMonth:'2026-10',row:daily}],seedEmployees,seedDepartments,[]);
 expect(dailyOverlay.daily[0]).toMatchObject({clickRate:0.17,conversionRate:0.12});
});
it('changing a native-rate numerator with unknown denominator invalidates only that rate',()=>{
 const reports=nativeRateReports(1),row=reports.hourly[0];
 const clicks=prepareReportCorrection(row,{clicks:row.clicks+1},seedEmployees,demoRooms,demoProducts);
 expect(clicks).toMatchObject({clickRate:null,conversionRate:0.12});
 const conversions=prepareReportCorrection(row,{conversions:row.conversions+1},seedEmployees,demoRooms,demoProducts);
 expect(conversions).toMatchObject({clickRate:0.17,conversionRate:null});
 const overlaid=applyReportOverrides(reports,[{period:'hourly',key:clicks.key,sourceMonth:'2026-10',row:clicks}],seedEmployees,seedDepartments,[]);
 expect(overlaid.hourly[0]).toMatchObject({clickRate:null,conversionRate:0.12});expect(overlaid.daily[0]).toMatchObject({clickRate:null,conversionRate:0.12});
});
it('multiple native hourly platform rates never become an invented daily average',()=>{
 const reports=nativeRateReports(2);
 expect(reports.hourly.every(row=>row.clickRate===0.17&&row.conversionRate===0.12)).toBe(true);
 expect(reports.daily[0]).toMatchObject({clickRate:null,conversionRate:null});
});


it('非均匀小时成交经日报修正后按实际贡献分配早班保费且不改时报测量值',()=>{
 const record={...demoRecords[0],start:'05:00',end:'09:00'};
 const source=demoRoomHours.filter(h=>h.roomId===record.roomId&&h.date===record.date&&h.start>=record.start&&h.end<=record.end).map(h=>({...h,revenue:h.start==='06:00'?900:h.start==='07:00'?300:100}));
 const base=buildRoomReports([record],source,seedEmployees,seedDepartments,demoRooms,demoProducts,'2026-10',[]),day=base.daily[0];
 expect(base.hourly.map(h=>h.earlyPremium)).toEqual([0,900,300,0]);
 expect(day.earlyPremium).toBe(1200);
 const edited=prepareReportCorrection(day,{revenue:2800},seedEmployees,demoRooms,demoProducts);
 const report=applyReportOverrides(base,[{period:'daily',key:day.key,sourceMonth:'2026-10',row:edited}],seedEmployees,seedDepartments,[record]);
 expect(report.daily[0].earlyPremium).toBe(2400);
 expect(report.hourly.map(h=>h.revenue)).toEqual(base.hourly.map(h=>h.revenue));
 expect(summarizeLiveDetails(report.contributions,seedEmployees,seedDepartments,'2026-10',[record])[0]).toMatchObject({premium:2800,nightPremium:200,earlyPremium:2400,regularPremium:200,regularHours:1});
});
it('小时早班成交修订传递到日报和月度早班保费',()=>{
 const base=build(),hour=base.hourly.find(h=>h.start==='06:00')!;
 const edited=prepareReportCorrection(hour,{revenue:hour.revenue+777},seedEmployees,demoRooms,demoProducts);
 const report=applyReportOverrides(base,[{period:'hourly',key:hour.key,sourceMonth:'2026-10',row:edited}],seedEmployees,seedDepartments,demoRecords);
 expect(report.daily.find(d=>d.key===hour.dailyKey)!.earlyPremium).toBe(base.daily.find(d=>d.key===hour.dailyKey)!.earlyPremium!+777);
 const before=summarizeLiveDetails(base.contributions,seedEmployees,seedDepartments,'2026-10',demoRecords)[0];
 const matching=summarizeLiveDetails(report.contributions,seedEmployees,seedDepartments,'2026-10',demoRecords).find(r=>r.employeeId===before.employeeId&&r.roomId===before.roomId)!;
 const expectedDelta=before.employeeId===hour.hostId||before.employeeId===hour.buyerId||before.employeeId===hour.controlId?777:0;
 expect(matching.earlyPremium).toBeCloseTo(before.earlyPremium!+expectedDelta);
});


it('缺失早班成交的历史整段修订经日报金额修订后仍未知，不从原始小时补回',()=>{
 const raw=buildLiveStatistics(demoRecords,demoRoomHours,seedEmployees,seedDepartments,demoRooms,demoProducts,'2026-10').details[0];
 const legacy={...raw,earlyPremium:undefined};
 const base=buildRoomReports(demoRecords,demoRoomHours,seedEmployees,seedDepartments,demoRooms,demoProducts,'2026-10',[{key:raw.id,sourceMonth:'2026-10',row:legacy}]);
 const day=base.daily.find(row=>row.sourceRecordIds.includes(raw.id))!;
 expect(day.earlyPremium).toBeUndefined();
 const edited=prepareReportCorrection(day,{revenue:day.revenue*2},seedEmployees,demoRooms,demoProducts);
 const reports=applyReportOverrides(base,[{period:'daily',key:day.key,sourceMonth:'2026-10',row:edited}],seedEmployees,seedDepartments,demoRecords);
 expect(reports.daily.find(row=>row.key===day.key)!.earlyPremium).toBeUndefined();
 expect(reports.contributions.find(row=>row.id===raw.id)!.earlyPremium).toBeUndefined();
 const row=summarizeLiveDetails(reports.contributions,seedEmployees,seedDepartments,'2026-10',demoRecords).find(row=>row.employeeId===raw.hostId&&row.roomId===raw.roomId)!;
 expect(row.earlyPremium).toBeUndefined();expect(row.regularPremium).toBeUndefined();
});

it('零成交日报改为非零时缺乏成交贡献比例，早班金额不按时长猜分',()=>{
 const record={...demoRecords[0],start:'05:00',end:'09:00'};
 const source=demoRoomHours.filter(h=>h.roomId===record.roomId&&h.date===record.date&&h.start>=record.start&&h.end<=record.end).map(h=>({...h,revenue:0}));
 const base=buildRoomReports([record],source,seedEmployees,seedDepartments,demoRooms,demoProducts,'2026-10',[]),day=base.daily[0];
 expect(day.earlyPremium).toBe(0);
 const edited=prepareReportCorrection(day,{revenue:2000},seedEmployees,demoRooms,demoProducts);
 expect(edited.earlyPremium).toBeUndefined();
 const report=applyReportOverrides(base,[{period:'daily',key:day.key,sourceMonth:'2026-10',row:edited}],seedEmployees,seedDepartments,[record]);
 expect(report.daily[0].earlyPremium).toBeUndefined();
 const row=summarizeLiveDetails(report.contributions,seedEmployees,seedDepartments,'2026-10',[record])[0];
 expect(row).toMatchObject({premium:2000,earlyPremium:undefined,regularPremium:undefined});
});

it('日报成交修订保留实际夜班贡献比例，月度正常保费排除夜早班',()=>{
 const base=build(),day=base.daily.find(row=>row.nightHours>0&&row.earlyHours>0)!;
 const corrected=prepareReportCorrection(day,{revenue:day.revenue*2},seedEmployees,demoRooms,demoProducts);
 const reports=applyReportOverrides(base,[{period:'daily',key:day.key,sourceMonth:'2026-10',row:corrected}],seedEmployees,seedDepartments,demoRecords);
 const effective=reports.daily.find(row=>row.key===day.key)!;
 expect(effective.nightPremium).toBeCloseTo(day.nightPremium!*2);
 expect(base.daily.find(row=>row.key===day.key)?.nightPremium).toBe(day.nightPremium);
});
