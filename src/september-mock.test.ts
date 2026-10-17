import { beforeEach, expect, it } from 'vitest';
import { useHub } from './store';
import { monthlyRowKey } from './dataset-corrections';
import type { CompensationRule } from './compensation-rules';

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

it('can calculate September waiting-day allowances and keeps the manual mock values after refresh',()=>{
 useHub.setState({session:{kind:'admin',username:'admin',method:'password'}});
 const rule:CompensationRule={id:'waiting-days',name:'等待薪资补贴',version:1,status:'草稿',scope:'global',roomIds:[],type:'allowance',allowance:{field:'waitingSalaryDays',amount:100}};
 const s=useHub.getState();s.setMonth(month);s.ensureMonthlyPayrollJobs(new Date('2026-10-01T00:00:00+08:00'));
 s.saveCompensationRule(rule);s.publishCompensationRule(rule.id);
 expect(()=>s.runPayroll()).not.toThrow();
 const calculated=useHub.getState(),rows=structuredClone(calculated.monthlyRows);
 expect(rows.every(row=>Number.isSafeInteger(row.waitingSalaryDays)&&row.waitingSalaryDays!>=0)).toBe(true);
 expect(calculated.batch!.compensationResult!.rows.every(row=>row.total===rows.find(input=>monthlyRowKey(input)===monthlyRowKey(row))!.waitingSalaryDays!*100)).toBe(true);
 expect(calculated.batch!.salaries.some(row=>row.total>0)).toBe(true);
 s.cleanDataset();expect(useHub.getState().monthlyRows).toEqual(rows);
});

it('repairs old September mock caches without replacing manual values or changing other months',()=>{
 useHub.getState().setMonth(month);
 const options=useHub.persist.getOptions(),saved=JSON.parse(JSON.stringify(options.partialize!(useHub.getState())));
 for(const rows of [saved.dataset.rows,saved.monthlyRows,saved.datasetsByMonth[month].rows]) {
  rows.forEach((row:{waitingSalaryDays?:number})=>delete row.waitingSalaryDays);
  rows[0].waitingSalaryDays=0;rows[1].waitingSalaryDays=7;
 }
 const restored=options.merge!(saved,useHub.getInitialState());
 expect(restored.dataset.rows.every(row=>Number.isSafeInteger(row.waitingSalaryDays))).toBe(true);
 expect(restored.dataset.rows.slice(0,2).map(row=>row.waitingSalaryDays)).toEqual([0,7]);
 expect(restored.monthlyRows).toEqual(restored.dataset.rows);
 expect(restored.dataset.version).toBe(saved.dataset.version+1);
 expect(restored.datasetsByMonth['2026-10']).toEqual(saved.datasetsByMonth['2026-10']);
 expect(restored.compensationRules).toEqual(saved.compensationRules);
 expect(restored.batches).toEqual(saved.batches);
 const again=options.merge!(options.partialize!(restored),useHub.getInitialState());
 expect(again.dataset).toEqual(restored.dataset);
});

it('keeps archived and non-mock September input untouched',()=>{
 useHub.getState().setMonth(month);
 const options=useHub.persist.getOptions(),saved=JSON.parse(JSON.stringify(options.partialize!(useHub.getState())));
 saved.dataset.rows.forEach((row:{waitingSalaryDays?:number})=>delete row.waitingSalaryDays);
 saved.monthlyRows=saved.dataset.rows;
 saved.datasetsByMonth[month]=saved.dataset;
 for(const source of [{...saved,archivedMonths:[month]},{...saved,liveRecords:saved.liveRecords.map((row:{id:string})=>({...row,id:'user-'+row.id}))}]) {
  const restored=options.merge!(source,useHub.getInitialState());
  expect(restored.dataset).toEqual(source.dataset);expect(restored.monthlyRows).toEqual(source.monthlyRows);
 }
});

it('preserves manually corrected waiting days through rehydration and a statistics refresh',()=>{
 useHub.getState().setMonth(month);
 let s=useHub.getState();
 const keys=s.monthlyRows.filter(row=>row.waitingSalaryDays!>0).slice(0,2).map(monthlyRowKey);
 s.saveDatasetCorrection('monthly',keys[0],{waitingSalaryDays:0},'人工确认零天',s.dataset.version);
 s=useHub.getState();s.saveDatasetCorrection('monthly',keys[1],{waitingSalaryDays:9},'人工确认九天',s.dataset.version);
 const options=useHub.persist.getOptions(),saved=JSON.parse(JSON.stringify(options.partialize!(useHub.getState())));
 useHub.setState(options.merge!(saved,useHub.getInitialState()),true);
 useHub.getState().cleanDataset();
 expect(keys.map(key=>useHub.getState().monthlyRows.find(row=>monthlyRowKey(row)===key)!.waitingSalaryDays)).toEqual([0,9]);
 expect(useHub.getState().correctionAudit).toEqual(saved.correctionAudit);
});

it.each([-1,NaN,Infinity,1.5])('does not hide invalid existing waiting days (%s) during migration',value=>{
 useHub.getState().setMonth(month);
 const options=useHub.persist.getOptions(),saved=structuredClone(options.partialize!(useHub.getState())) as ReturnType<typeof useHub.getState>;
 saved.dataset.rows[0].waitingSalaryDays=value;
 const restored=options.merge!(saved,useHub.getInitialState());
 expect(restored.dataset.rows[0].waitingSalaryDays).toBe(value);
});
