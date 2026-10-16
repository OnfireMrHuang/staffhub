import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { calculateCompensation } from './compensation-rules';
import { payrollSettlementExample as example } from './payroll-settlement-example';
import type { Batch } from './store';
import type { PayrollCellValue } from './payroll-review';
import { appendPayrollColumn, applyPayrollReview, buildReviewedPayrollWorkbook, createPayrollReview, editPayrollDetail, editablePayrollDetailColumns, payrollDetailKey, payrollDetailValues } from './payroll-review';

function fixture():Batch {
 const result=calculateCompensation(example.rows,example.employees,example.departments,example.rooms,example.rules,example.month);
 return {month:example.month,status:'已核算',salaries:structuredClone(result.salaries),compensationResult:result,datasetVersion:1,ruleVersion:1,created:'2026-10-01',logs:[],snapshot:{records:[],adHours:[],roomHours:[],employees:structuredClone(example.employees),departments:structuredClone(example.departments),products:[],rooms:structuredClone(example.rooms),details:[],monthly:structuredClone(example.rows),dataset:{rows:structuredClone(example.rows),month:example.month,version:1,revision:1,published:true},departmentRules:[],payrollTasks:[]},review:createPayrollReview()};
}

describe('payroll result review overlays',()=>{
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
});
