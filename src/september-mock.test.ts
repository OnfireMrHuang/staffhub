import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import { monthlyRowKey } from './dataset-corrections';

const month='2026-09';
beforeEach(()=>useHub.getState().reset());
function legacySave() {
 const saved=JSON.parse(JSON.stringify(useHub.persist.getOptions().partialize!(useHub.getState())));
 delete saved.septemberMockInitialized;
 saved.liveRecords=saved.liveRecords.filter((row:{date:string})=>!row.date.startsWith(month));
 saved.roomHours=saved.roomHours.filter((row:{date:string})=>!row.date.startsWith(month));
 delete saved.datasetsByMonth[month];
 return saved;
}

it('provides September monthly rows backed by raw hours and preserves them through refresh',()=>{
 const october=structuredClone(useHub.getState().dataset);
 useHub.getState().setMonth(month);const s=useHub.getState();
 expect(s.dataset.published).toBe(true);expect(s.monthlyRows).toHaveLength(12);
 expect(new Set(s.monthlyRows.map(monthlyRowKey)).size).toBe(12);
 expect(new Set(s.monthlyRows.map(row=>row.roomId)).size).toBe(3);
 expect(s.monthlyRows.every(row=>row.month===month&&row.year===2026&&row.hours>0&&row.spend>0&&row.premium>0)).toBe(true);
 expect(s.liveRecords.filter(row=>row.date.startsWith(month))).toHaveLength(30);
 expect(s.roomHours.filter(row=>row.date.startsWith(month))).toHaveLength(192);
 const rows=structuredClone(s.monthlyRows);s.cleanDataset();
 expect(useHub.getState().monthlyRows).toEqual(rows);
 for(const row of rows){
  expect(row.regularHours).toBe(row.hours-row.nightHours-row.earlyHours);
  expect(row.regularPremium).toBeCloseTo(row.premium-row.nightPremium!-row.earlyPremium!);
  expect(row.roi).toBeCloseTo(row.premium/row.spend);
 }
 s.setMonth('2026-10');expect(useHub.getState().dataset).toEqual(october);
});

it('adds missing September data to existing saves once, including an already selected empty September page',()=>{
 const options=useHub.persist.getOptions(),saved=legacySave(),october=structuredClone(saved.dataset);
 saved.month=month;saved.monthlyRows=[];saved.liveDetails=[];saved.reportHours=[];saved.reportDays=[];
 saved.dataset={rows:[],month,version:3,revision:-1,published:false};
 const restored=options.merge!(saved,useHub.getInitialState());
 expect(restored.dataset.rows).toHaveLength(12);expect(restored.dataset).toMatchObject({month,published:true,revision:restored.revision});
 expect(restored.monthlyRows).toEqual(restored.dataset.rows);
 expect(restored.revision).toBe(saved.revision);expect(restored.batch).toEqual(saved.batch);expect(restored.compensationRules).toEqual(saved.compensationRules);
 const again=options.merge!(options.partialize!(restored),useHub.getInitialState());
 expect(again.liveRecords).toEqual(restored.liveRecords);expect(again.roomHours).toEqual(restored.roomHours);expect(again.dataset).toEqual(restored.dataset);
 expect(saved.liveRecords.every((row:{date:string})=>row.date.startsWith('2026-10'))).toBe(true);
 const otherMonth=options.merge!({...saved,month:'2026-10',dataset:october},useHub.getInitialState());
 expect(otherMonth.dataset).toEqual(october);
});

it.each(['archive','source','monthly'] as const)('preserves existing September %s data without appending mock sources',kind=>{
 const options=useHub.persist.getOptions(),saved=legacySave();
 if(kind==='archive')saved.archivedMonths=[month];
 if(kind==='source')saved.liveRecords.push({...saved.liveRecords[0],id:'user-september',date:'2026-09-12'});
 if(kind==='monthly')saved.datasetsByMonth[month]={...saved.dataset,month,rows:[{...saved.dataset.rows[0],month}]};
 const restored=options.merge!(saved,useHub.getInitialState());
 expect(restored.liveRecords).toEqual(saved.liveRecords);expect(restored.roomHours).toEqual(saved.roomHours);
 expect(restored.archivedMonths).toEqual(saved.archivedMonths);expect(restored.datasetsByMonth).toEqual(saved.datasetsByMonth);
});

it('only seeds rooms whose existing employee and platform-account associations still match',()=>{
 const options=useHub.persist.getOptions(),saved=legacySave();
 saved.rooms=saved.rooms.map((room:{platformAccountId:string})=>({...room,platformAccountId:'changed-account'}));
 const restored=options.merge!(saved,useHub.getInitialState());
 expect(restored.liveRecords).toEqual(saved.liveRecords);expect(restored.roomHours).toEqual(saved.roomHours);
});
