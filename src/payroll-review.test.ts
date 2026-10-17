import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { calculateCompensation } from './compensation-rules';
import { payrollSettlementExample as example } from './payroll-settlement-example';
import type { Batch } from './store';
import type { PayrollCellValue } from './payroll-review';
import { allPayrollDetailColumns, appendPayrollColumn, applyPayrollReview, buildReviewedPayrollWorkbook, createPayrollReview, deletePayrollColumn, editPayrollDetail, editablePayrollDetailColumns, payrollDetailKey, payrollDetailLayout, payrollDetailValues } from './payroll-review';

function fixture():Batch {
 const result=calculateCompensation(example.rows,example.employees,example.departments,example.rooms,example.rules,example.month);
 return {month:example.month,status:'已核算',salaries:structuredClone(result.salaries),compensationResult:result,datasetVersion:1,ruleVersion:1,created:'2026-10-01',logs:[],snapshot:{records:[],adHours:[],roomHours:[],employees:structuredClone(example.employees),departments:structuredClone(example.departments),products:[],rooms:structuredClone(example.rooms),details:[],monthly:structuredClone(example.rows),dataset:{rows:structuredClone(example.rows),month:example.month,version:1,revision:1,published:true},departmentRules:[],payrollTasks:[]},review:createPayrollReview()};
}

describe('payroll result review overlays',()=>{
 it('deletes a custom header and its draft values across all rows without altering salaries or unrelated edits',()=>{
  let batch=appendPayrollColumn(fixture(),{id:'note',label:'复核备注',type:'text'},'HR');
  batch=appendPayrollColumn(batch,{id:'amount',label:'补充金额',type:'money'},'HR');
  const rows=batch.compensationResult!.rows;
  for(const row of rows) batch=editPayrollDetail(batch,payrollDetailKey(row),{note:'待复核',amount:0},'补充资料','HR');
  batch=applyPayrollReview(batch,'HR');
  const key=payrollDetailKey(rows[0]);
  batch=editPayrollDetail(batch,key,{'result.total':123,note:'已修正'},'调整','HR');
  const before=structuredClone(batch),deleted=deletePayrollColumn(batch,'note','HR');
  expect(batch).toEqual(before);expect(deleted.salaries).toEqual(before.salaries);
  expect(deleted.compensationResult).toEqual(before.compensationResult);expect(deleted.snapshot).toEqual(before.snapshot);
  expect(deleted.review!.columns.map(column=>column.id)).toEqual(['amount']);
  expect(Object.values(deleted.review!.draftCells).every(cells=>!Object.hasOwn(cells,'note'))).toBe(true);
  expect(payrollDetailValues(deleted,rows[0])).toMatchObject({amount:0,'result.total':123});
  expect(deleted.review).toMatchObject({dirty:true,version:before.review!.version+1,appliedColumns:before.review!.appliedColumns,appliedCells:before.review!.appliedCells});
  expect(deleted.review!.audit.at(-1)).toMatchObject({action:'delete-column',actor:'HR',before:{column:{id:'note'},cells:{[key]:'已修正'}},after:null});
  const data=XLSX.utils.sheet_to_json<(string|number)[]>(buildReviewedPayrollWorkbook(deleted).Sheets['月度核算明细'],{header:1});
  expect(data[1]).not.toContain('复核备注');expect(data[1]).toContain('补充金额');
  const applied=applyPayrollReview(deleted,'HR');
  expect(applied.review!.appliedColumns.map(column=>column.id)).toEqual(['amount']);
  expect(Object.values(applied.review!.appliedCells).every(cells=>!Object.hasOwn(cells,'note'))).toBe(true);
 });
 it('removes the custom group when its last header is deleted and rejects built-in or unknown headers',()=>{
  const batch=appendPayrollColumn(fixture(),{id:'note',label:'备注',type:'text'},'HR'),before=structuredClone(batch);
  for(const id of ['result.total','employeeId','missing']) expect(()=>deletePayrollColumn(batch,id,'HR')).toThrow(/自定义表头/);
  expect(batch).toEqual(before);
  const deleted=deletePayrollColumn(batch,'note','HR');
  expect(payrollDetailLayout(deleted).groups.some(group=>group.key==='custom')).toBe(false);
  expect(()=>deletePayrollColumn(deleted,'note','HR')).toThrow(/自定义表头/);
 });
 it('edits independent result cells without recalculating any field or changing frozen originals or salary summary',()=>{
  const batch=fixture(),before=structuredClone(batch),row=batch.compensationResult!.rows[0],key=payrollDetailKey(row);
  const updated=editPayrollDetail(batch,key,{spend:1,roi:999,'result.total':123.45},'核对调整','HR');
  expect(batch).toEqual(before);
  expect(updated.snapshot).toEqual(before.snapshot);
  expect(updated.compensationResult).toEqual(before.compensationResult);
  expect(updated.salaries).toEqual(before.salaries);
  expect(payrollDetailValues(updated,row)).toMatchObject({spend:1,roi:999,'result.total':123.45,premium:payrollDetailValues(batch,row).premium});
  expect(updated.review).toMatchObject({dirty:true,version:1,appliedCells:{}});
  expect(updated.review!.audit[0]).toMatchObject({actor:'HR',reason:'核对调整',rowKey:key,version:1});
 });
 it('applies only final monthly detail salary to the employee summary and snapshots applied values',()=>{
  const batch=fixture(),row=batch.compensationResult!.rows[0],key=payrollDetailKey(row);
  const initial=payrollDetailValues(batch,row)['result.total'] as number;
  const pending=editPayrollDetail(batch,key,{'result.total':100.25,'result.allowance':8000},'人工确认','HR');
  const applied=applyPayrollReview(pending,'HR');
  const employee=applied.salaries.find(item=>item.employeeId===row.employeeId)!;
  expect(employee.total).toBe(Math.round((batch.salaries.find(item=>item.employeeId===row.employeeId)!.total-initial+100.25)*100)/100);
  expect(employee.commission+employee.fixed).toBe(employee.total);
  expect(applied.compensationResult).toEqual(batch.compensationResult);
  expect(applied.review!.audit.at(-1)).toMatchObject({action:'apply',version:2});
  expect(applied.review).toMatchObject({dirty:false,version:2,draftCells:pending.review!.draftCells,appliedCells:pending.review!.draftCells});
  const again=editPayrollDetail(applied,key,{'result.total':300},'再次修正','HR');
  expect(again.salaries).toEqual(applied.salaries);
  expect(again.review!.appliedCells[key]['result.total']).toBe(100.25);
 });
 it('keeps performance edits independent, exports the override before salary, and applies only explicit salary totals',()=>{
  const batch=fixture(),before=structuredClone(batch),row=batch.compensationResult!.rows[0],key=payrollDetailKey(row);
  expect(editablePayrollDetailColumns(batch).find(column=>column.key==='result.performance')).toMatchObject({label:'总计绩效金额',type:'money',custom:false});
  const edited=editPayrollDetail(batch,key,{'result.performance':0},'单独复核绩效','HR');
  expect(payrollDetailValues(edited,row)).toMatchObject({'result.performance':0,'result.allowance':row.allowance,'result.total':row.total});
  const applied=applyPayrollReview(edited,'HR');
  expect(applied.salaries).toEqual(batch.salaries);
  expect(applied.review!.appliedCells[key]['result.performance']).toBe(0);
  const workbook=buildReviewedPayrollWorkbook(applied);
  const exported=XLSX.read(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),{type:'array',cellNF:true});
  const sheet=exported.Sheets['月度核算明细'];
  const rows=XLSX.utils.sheet_to_json<(string|number)[]>(sheet,{header:1});
  const performanceIndex=rows[1].indexOf('总计绩效金额'),totalIndex=rows[1].indexOf('总计月薪');
  expect(performanceIndex).toBe(totalIndex-1);
  expect(sheet[XLSX.utils.encode_cell({r:2,c:performanceIndex})]).toMatchObject({t:'n',v:0,z:'0.00'});
  expect(rows[2][totalIndex]).toBe(row.total);
  expect(batch).toEqual(before);
  expect(applied.compensationResult).toEqual(before.compensationResult);
 });
 it('rounds the explicitly applied employee total consistently with payroll settlement without changing draft values',()=>{
  const batch=fixture(),before=structuredClone(batch),first=batch.compensationResult!.rows[0];
  const rows=batch.compensationResult!.rows.filter(row=>row.employeeId===first.employeeId);
  expect(rows).toHaveLength(2);
  const pending=rows.reduce((current,row,index)=>editPayrollDetail(current,payrollDetailKey(row),{'result.total':index===0?10.075:0},'金额复核','HR'),batch);
  const applied=applyPayrollReview(pending,'HR');
  expect(applied.salaries.find(salary=>salary.employeeId===first.employeeId)).toMatchObject({total:10.08,commission:10.08});
  expect(payrollDetailValues(applied,first)['result.total']).toBe(10.075);
  expect(pending.salaries).toEqual(before.salaries);
  expect(applied.compensationResult).toEqual(before.compensationResult);
  expect(applied.snapshot).toEqual(before.snapshot);
  expect(batch).toEqual(before);
 });
 it('supports supplemental typed columns without including their numeric values in salary totals',()=>{
  let batch=fixture();
  const original=structuredClone(batch.salaries),row=batch.compensationResult!.rows[0],key=payrollDetailKey(row);
  batch=appendPayrollColumn(batch,{id:'reviewNote',label:'核对备注',type:'text'},'HR');
  batch=appendPayrollColumn(batch,{id:'supplement',label:'补充金额',type:'money'},'HR');
  expect(payrollDetailValues(batch,row)).toMatchObject({reviewNote:null,supplement:null});
  batch=editPayrollDetail(batch,key,{reviewNote:'已核对',supplement:99999},'复核','HR');
  const applied=applyPayrollReview(batch,'HR');
  expect(applied.salaries).toEqual(original);
  expect(applied.review!.appliedColumns).toEqual(batch.review!.columns);
  expect(editablePayrollDetailColumns(batch).find(column=>column.key==='supplement')).toMatchObject({type:'money',custom:true});
 });
 it('keeps frozen dimensions read-only and rejects unknown and malformed values atomically',()=>{
  const batch=fixture(),before=structuredClone(batch),key=payrollDetailKey(batch.compensationResult!.rows[0]);
  expect(editablePayrollDetailColumns(batch).map(column=>column.key)).not.toContain('year');
  const invalidPatches:Record<string,PayrollCellValue>[]=[{employeeId:'new'},{year:2027},{'result.total':-1},{'result.total':Infinity},{spend:NaN},{roiRank:1.5},{unknown:4},{spend:'1'},{spend:2,roomId:'new'}];
  for(const patch of invalidPatches) {
   expect(()=>editPayrollDetail(batch,key,patch,'复核','HR')).toThrow();
  }
  expect(()=>editPayrollDetail(batch,'missing',{spend:2},'复核','HR')).toThrow(/数据行/);
  expect(()=>editPayrollDetail(batch,key,{spend:2},' ','HR')).toThrow(/原因/);
  expect(batch).toEqual(before);
 });
 it('validates column IDs, labels, types and custom cell values',()=>{
  const batch=fixture();
  for(const column of [{id:'roi',label:'补充',type:'number'},{id:'custom',label:'总计月薪',type:'money'},{id:'__proto__',label:'补充',type:'text'},{id:'custom',label:'',type:'text'},{id:'custom',label:'补充',type:'date'}]) {
   expect(()=>appendPayrollColumn(batch,column as Parameters<typeof appendPayrollColumn>[1],'HR')).toThrow();
  }
  const updated=appendPayrollColumn(batch,{id:'note',label:'备注',type:'text'},'HR');
  const key=payrollDetailKey(updated.compensationResult!.rows[0]);
  expect(()=>appendPayrollColumn(updated,{id:'note',label:'重复',type:'number'},'HR')).toThrow();
  expect(()=>editPayrollDetail(updated,key,{note:1},'复核','HR')).toThrow();
  expect(()=>appendPayrollColumn(updated,{id:'note2',label:' 备注 ',type:'text'},'HR')).toThrow();
 });
 it('preserves an existing custom performance column after the built-in column is introduced',()=>{
  const batch=fixture(),row=batch.compensationResult!.rows[0],key=payrollDetailKey(row);
  delete row.performance;
  batch.review!.columns=[{id:'custom_perf',label:'总计绩效金额',type:'money'}];
  batch.review!.draftCells[key]={custom_perf:123.45};
  const before=structuredClone(batch);
  expect(payrollDetailValues(batch,row)).toMatchObject({custom_perf:123.45,'result.performance':6800});
  const edited=editPayrollDetail(batch,key,{custom_perf:456.78,'result.performance':6000},'分别核对绩效','HR');
  const applied=applyPayrollReview(edited,'HR');
  expect(payrollDetailValues(applied,row)).toMatchObject({custom_perf:456.78,'result.performance':6000,'result.total':row.total});
  expect(applied.review!.columns).toEqual(before.review!.columns);
  expect(applied.review!.appliedCells[key]).toEqual({custom_perf:456.78,'result.performance':6000});
  expect(applied.salaries).toEqual(before.salaries);
  const columns=allPayrollDetailColumns(applied);
  const data=XLSX.utils.sheet_to_json<(string|number)[]>(buildReviewedPayrollWorkbook(applied).Sheets['月度核算明细'],{header:1});
  const customIndex=columns.findIndex(column=>column.key==='custom_perf'),builtInIndex=columns.findIndex(column=>column.key==='result.performance');
  expect(data[1][customIndex]).toBe('总计绩效金额');
  expect(data[1][builtInIndex]).toBe('总计绩效金额');
  expect(data[2][customIndex]).toBe(456.78);
  expect(data[2][builtInIndex]).toBe(6000);
  expect(()=>appendPayrollColumn(applied,{id:'another_perf',label:'总计绩效金额',type:'money'},'HR')).toThrow(/名称已存在/);
  expect(()=>appendPayrollColumn(fixture(),{id:'new_perf',label:'总计绩效金额',type:'money'},'HR')).toThrow(/名称已存在/);
  expect(appendPayrollColumn(applied,{id:'note',label:'备注',type:'text'},'HR').review!.columns).toHaveLength(2);
  expect(batch).toEqual(before);
  expect(applied.compensationResult).toEqual(before.compensationResult);
 });
 it('still rejects malformed or duplicate persisted custom columns when built-in labels overlap',()=>{
  const batch=fixture(),key=payrollDetailKey(batch.compensationResult!.rows[0]);
  for(const columns of [
   [{id:'bad.id',label:'总计绩效金额',type:'money'}],
   [{id:'custom_perf',label:'总计绩效金额',type:'date'}],
   [{id:'custom_perf',label:'总计绩效金额',type:'money'},{id:'other_perf',label:' 总计绩效金额 ',type:'money'}],
   [{id:'custom_perf',label:'总计绩效金额',type:'money'},{id:'custom_perf',label:'其他绩效',type:'money'}],
  ]){
   batch.review!.columns=columns as NonNullable<Batch['review']>['columns'];
   expect(()=>editPayrollDetail(batch,key,{'result.total':100},'复核','HR')).toThrow();
   expect(()=>applyPayrollReview(batch,'HR')).toThrow();
  }
 });
 it('rejects aggregate monetary overflow and invalid persisted overlays without mutating input',()=>{
  const batch=fixture(),key=payrollDetailKey(batch.compensationResult!.rows[0]);
  expect(()=>editPayrollDetail(batch,key,{'result.total':Number.MAX_VALUE},'复核','HR')).toThrow();
  const sameEmployee=batch.compensationResult!.rows.filter(row=>row.employeeId===batch.compensationResult!.rows[0].employeeId);
  expect(sameEmployee).toHaveLength(2);
  const overflow=sameEmployee.reduce((current,row)=>editPayrollDetail(current,payrollDetailKey(row),{'result.total':60_000_000_000_000},'复核','HR'),batch);
  const overflowBefore=structuredClone(overflow);
  expect(()=>applyPayrollReview(overflow,'HR')).toThrow(/范围/);
  expect(overflow).toEqual(overflowBefore);
  batch.review!.draftCells[key]={'result.total':NaN};
  const before=structuredClone(batch);
  expect(()=>applyPayrollReview(batch,'HR')).toThrow();
  expect(batch).toEqual(before);
 });
 it('exports draft detail values and the separately applied employee salary summary',()=>{
  let batch=fixture(),row=batch.compensationResult!.rows[0],key=payrollDetailKey(row);
  const summaryBefore=batch.salaries[0].total;
  batch=appendPayrollColumn(batch,{id:'note',label:'核对备注',type:'text'},'HR');
  batch=editPayrollDetail(batch,key,{'result.total':111,note:'待应用'},'复核','HR');
  const workbook=buildReviewedPayrollWorkbook(batch);
  expect(workbook.SheetNames).toEqual(['月度核算明细','员工月薪汇总']);
  const detail=XLSX.utils.sheet_to_json<(string|number)[]>(workbook.Sheets['月度核算明细'],{header:1});
  const headers=detail[1];
  expect(detail[2][headers.indexOf('总计月薪')]).toBe(111);
  expect(detail[2][headers.indexOf('核对备注')]).toBe('待应用');
  const summary=XLSX.utils.sheet_to_json<(string|number)[]>(workbook.Sheets['员工月薪汇总'],{header:1});
  expect(summary[1][4]).toBe(summaryBefore);
 });
 it.each([false,true])('places custom columns immediately before results in the table, editor and export (historical scope: %s)',historical=>{
  let batch=fixture();
  const row=batch.compensationResult!.rows[0],key=payrollDetailKey(row);
  if(historical) row.scopes!.employees.allowance=1;
  const originalKeys=allPayrollDetailColumns(batch).map(column=>column.key);
  for(const column of [{id:'note',label:'复核备注',type:'text'},{id:'days',label:'补充天数',type:'number'},{id:'adjustment',label:'补充金额',type:'money'}] as const) batch=appendPayrollColumn(batch,column,'HR');
  batch=editPayrollDetail(batch,key,{note:'确认',days:2,adjustment:125.5,'result.total':321},'核对','HR');
  const columns=allPayrollDetailColumns(batch),resultIndex=columns.findIndex(column=>column.group==='result');
  expect(columns.slice(resultIndex-3,resultIndex).map(column=>column.key)).toEqual(['note','days','adjustment']);
  expect(columns.filter(column=>!column.custom).map(column=>column.key)).toEqual(originalKeys);
  const editable=editablePayrollDetailColumns(batch);
  expect(editable.findIndex(column=>column.key==='adjustment')).toBeLessThan(editable.findIndex(column=>column.group==='result'));
  const sheet=buildReviewedPayrollWorkbook(batch).Sheets['月度核算明细'];
  const data=XLSX.utils.sheet_to_json<(string|number)[]>(sheet,{header:1});
  expect(data[0][resultIndex-3]).toBe('自定义');expect(data[0][resultIndex]).toBe('结果指标');
  expect(sheet['!merges']).toContainEqual({s:{r:0,c:resultIndex-3},e:{r:0,c:resultIndex-1}});
  expect(data[1]).toEqual(columns.map(column=>column.label));
  expect(data[2].slice(resultIndex-3,resultIndex)).toEqual(['确认',2,125.5]);
  expect(data[2][columns.findIndex(column=>column.key==='result.total')]).toBe(321);
 });
});
