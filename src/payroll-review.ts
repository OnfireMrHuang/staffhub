import * as XLSX from 'xlsx';
import type { PayrollRowCalculation } from './compensation-rules';
import { monthlyRowKey } from './dataset-corrections';
import type { LiveMonthly } from './live-domain';
import { monthlyCountFields, monthlyDimensions } from './pages/LiveDatasetFields';
import { payrollSettlementCells, payrollSettlementLayout } from './payroll-settlement-sheet';
import type { Batch } from './store';

export interface PayrollCustomColumn { id:string; label:string; type:'text'|'number'|'money' }
export type PayrollCellValue=string|number|null;
export interface PayrollReviewAudit {
 id:string; at:string; actor:string; action:'edit-detail'|'append-column'|'apply'; reason?:string;
 rowKey?:string; before?:unknown; after?:unknown; version?:number;
}
export interface PayrollReview {
 version:number; dirty:boolean; columns:PayrollCustomColumn[]; appliedColumns:PayrollCustomColumn[];
 draftCells:Record<string,Record<string,PayrollCellValue>>;
 appliedCells:Record<string,Record<string,PayrollCellValue>>;
 audit:PayrollReviewAudit[]; appliedAt?:string;
}
export interface PayrollReviewColumn {
 key:string; label:string; group:string; numeric:boolean; type:PayrollCustomColumn['type']; custom:boolean; readonly:boolean;
}
const dimensions=new Set<string>(monthlyDimensions.map(column=>column.key));
const normalizeLabel=(value:string)=>value.normalize('NFKC').trim();
const finiteNumber=(value:unknown):value is number=>typeof value==='number' && Number.isFinite(value);
const safeMoney=(value:number)=>Number.isFinite(value) && Math.abs(value)*100<=Number.MAX_SAFE_INTEGER;
const money=(value:number)=>{
 if(!safeMoney(value))throw new Error('月薪金额超出可安全处理的范围');
 // Match settlement rounding: decimal shifting preserves half-cent inputs such as 10.075.
 const [significand,exponent='0']=value.toString().split('e');
 const shifted=Number(`${significand}e${Number(exponent)+2}`);
 const half=Math.floor(shifted)+0.5;
 const corrected=!Number.isInteger(shifted)&&shifted<half&&half-shifted<=Number.EPSILON*shifted?half:shifted;
 return Math.round(corrected)/100;
};

export function createPayrollReview():PayrollReview {
 return {version:0,dirty:false,columns:[],appliedColumns:[],draftCells:{},appliedCells:{},audit:[]};
}
export const payrollDetailKey=(row:Pick<PayrollRowCalculation,'employeeId'|'roomId'|'month'>):string=>monthlyRowKey(row);
const reviewOf=(batch:Batch)=>batch.review??createPayrollReview();
function resultOf(batch:Batch) {
 if(!batch.compensationResult)throw new Error('当前核算任务没有可复核的月度核算明细');
 return batch.compensationResult;
}
function rowsOf(batch:Batch) {
 const rows=resultOf(batch).rows,keys=rows.map(payrollDetailKey);
 if(new Set(keys).size!==keys.length)throw new Error('月度核算明细存在重复数据行');
 return rows;
}
function validateColumn(batch:Batch,column:PayrollCustomColumn,existing:PayrollCustomColumn[]) {
 if(!column || typeof column.id!=='string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(column.id))throw new Error('追加字段标识须以字母开头，仅包含字母、数字、下划线或短横线');
 if(typeof column.label!=='string' || !normalizeLabel(column.label) || normalizeLabel(column.label).length>80)throw new Error('请填写 1 至 80 字的追加表头名称');
 if(!['text','number','money'].includes(column.type))throw new Error('追加字段类型仅支持文本、数字或金额');
 const builtIn=payrollSettlementLayout(resultOf(batch)).columns;
 if(builtIn.some(field=>field.key===column.id)||existing.some(field=>field.id===column.id))throw new Error('追加字段标识已存在');
 const label=normalizeLabel(column.label);
 if(builtIn.some(field=>normalizeLabel(field.label)===label)||existing.some(field=>normalizeLabel(field.label)===label))throw new Error('追加表头名称已存在');
}
function validateColumns(batch:Batch) {
 const checked:PayrollCustomColumn[]=[];
 for(const column of reviewOf(batch).columns){validateColumn(batch,column,checked);checked.push(column);}
}
export function allPayrollDetailColumns(batch:Batch):PayrollReviewColumn[] {
 const base=payrollSettlementLayout(resultOf(batch)).columns;
 return [
  ...base.map(column=>({...column,type:(!column.numeric?'text':column.group==='statistics'?'number':'money') as PayrollCustomColumn['type'],custom:false,readonly:dimensions.has(column.key)||!column.numeric})),
  ...reviewOf(batch).columns.map(column=>({key:column.id,label:column.label,group:'custom',numeric:column.type!=='text',type:column.type,custom:true,readonly:false})),
 ];
}
export const editablePayrollDetailColumns=(batch:Batch)=>allPayrollDetailColumns(batch).filter(column=>!column.readonly);
function validatePatch(batch:Batch,patch:Record<string,PayrollCellValue>) {
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('核算明细修订内容无效');
 const columns=editablePayrollDetailColumns(batch);
 for(const [key,value] of Object.entries(patch)){
  const column=columns.find(item=>item.key===key);
  if(!column)throw new Error(`字段 ${key} 不存在或为只读关联字段`);
  if(column.custom){
   if(value===null)continue;
   if(column.type==='text'){
    if(typeof value!=='string')throw new Error(`${column.label} 必须填写文本`);
   }else if(!finiteNumber(value)||(column.type==='money'&&!safeMoney(value)))throw new Error(`${column.label} 必须填写有效数值`);
   continue;
  }
  if(!finiteNumber(value)||value<0)throw new Error(`${column.label} 必须填写非负有限数值`);
  if(monthlyCountFields.has(key as keyof LiveMonthly)&&!Number.isSafeInteger(value))throw new Error(`${column.label} 必须填写非负整数`);
  if(column.type==='money'&&!safeMoney(value))throw new Error(`${column.label} 超出可安全处理的金额范围`);
 }
}
function requireRow(batch:Batch,key:string) {
 const row=rowsOf(batch).find(item=>payrollDetailKey(item)===key);
 if(!row)throw new Error('核算数据行不存在，请刷新后重试');
 return row;
}
function baseValues(batch:Batch,row:PayrollRowCalculation):Record<string,PayrollCellValue> {
 const layout=payrollSettlementLayout(resultOf(batch));
 const values=payrollSettlementCells(row,layout);
 return Object.fromEntries(layout.columns.map((column,index)=>[column.key,values[index]]));
}
export function payrollDetailValues(batch:Batch,row:PayrollRowCalculation):Record<string,PayrollCellValue> {
 const key=payrollDetailKey(row),original=requireRow(batch,key);
 const values=baseValues(batch,original);
 for(const column of reviewOf(batch).columns)values[column.id]=null;
 const draft=reviewOf(batch).draftCells[key]??{};
 validatePatch(batch,draft);
 return {...values,...draft};
}
function audit(review:PayrollReview,actor:string,entry:Omit<PayrollReviewAudit,'id'|'at'|'actor'|'version'>) {
 if(typeof actor!=='string'||!actor.trim())throw new Error('缺少核算复核操作人');
 const at=new Date().toISOString();
 review.audit.push({id:`payroll-review-${crypto.randomUUID()}`,at,actor:actor.trim(),version:review.version,...entry});
 return at;
}
function cloneForReview(batch:Batch) {
 const next=structuredClone(batch);
 next.review=structuredClone(reviewOf(batch));
 return next as Batch & {review:PayrollReview};
}
export function editPayrollDetail(batch:Batch,key:string,patch:Record<string,PayrollCellValue>,reason:string,actor:string):Batch {
 if(typeof reason!=='string'||!reason.trim())throw new Error('请填写核算明细修订原因');
 const row=requireRow(batch,key);
 validateColumns(batch);validatePatch(batch,patch);
 if(!Object.keys(patch).length)throw new Error('请填写需要修订的明细字段');
 const before=payrollDetailValues(batch,row),next=cloneForReview(batch);
 next.review.draftCells[key]={...next.review.draftCells[key],...structuredClone(patch)};
 next.review.version++;next.review.dirty=true;
 audit(next.review,actor,{action:'edit-detail',reason:reason.trim(),rowKey:key,before:Object.fromEntries(Object.keys(patch).map(field=>[field,before[field]])),after:structuredClone(patch)});
 return next;
}
export function appendPayrollColumn(batch:Batch,column:PayrollCustomColumn,actor:string):Batch {
 validateColumns(batch);validateColumn(batch,column,reviewOf(batch).columns);
 const next=cloneForReview(batch),clean={...column,label:normalizeLabel(column.label)};
 next.review.columns.push(clean);next.review.version++;next.review.dirty=true;
 audit(next.review,actor,{action:'append-column',after:structuredClone(clean)});
 return next;
}
export function applyPayrollReview(batch:Batch,actor:string):Batch {
 validateColumns(batch);
 const rows=rowsOf(batch),keys=new Set(rows.map(payrollDetailKey));
 for(const [key,patch] of Object.entries(reviewOf(batch).draftCells)){
  if(!keys.has(key))throw new Error('核算修订中包含不存在的数据行');
  validatePatch(batch,patch);
 }
 const totals=new Map<string,number>();
 for(const row of rows){
  const total=payrollDetailValues(batch,row)['result.total'];
  if(!finiteNumber(total)||total<0||!safeMoney(total))throw new Error('总计月薪必须为非负有效金额');
  const sum=(totals.get(row.employeeId)??0)+total;
  if(!safeMoney(sum))throw new Error('员工月薪合计超出可安全处理的范围');
  totals.set(row.employeeId,sum);
 }
 const originals=resultOf(batch).salaries;
 if(new Set(originals.map(salary=>salary.employeeId)).size!==originals.length||originals.length!==totals.size||originals.some(salary=>!totals.has(salary.employeeId)))throw new Error('核算明细与员工工资汇总的员工范围不一致');
 const next=cloneForReview(batch);
 next.salaries=originals.map(salary=>{
  const total=money(totals.get(salary.employeeId)!);
  if(!finiteNumber(salary.fixed)||salary.fixed<0||salary.fixed>total)throw new Error('月薪合计不能低于冻结的固定薪资');
  return {...structuredClone(salary),total,commission:money(total-salary.fixed)};
 });
 next.review.appliedColumns=structuredClone(next.review.columns);
 next.review.appliedCells=structuredClone(next.review.draftCells);
 next.review.version++;next.review.dirty=false;
 next.review.appliedAt=audit(next.review,actor,{action:'apply',before:structuredClone(batch.salaries),after:structuredClone(next.salaries)});
 return next;
}

/** Detail exports include pending edits; employee totals remain at the last explicit application. */
export function buildReviewedPayrollWorkbook(batch:Batch):XLSX.WorkBook {
 const workbook=XLSX.utils.book_new(),rows=rowsOf(batch),columns=allPayrollDetailColumns(batch),layout=payrollSettlementLayout(resultOf(batch));
 const groups=[...layout.groups,...(reviewOf(batch).columns.length?[{key:'custom',label:'补充字段',count:reviewOf(batch).columns.length}]:[])];
 const headers=Array<string>(columns.length).fill(''),merges:XLSX.Range[]=[];
 let first=0;
 for(const group of groups){headers[first]=group.label;if(group.count>1)merges.push({s:{r:0,c:first},e:{r:0,c:first+group.count-1}});first+=group.count;}
 const detail=XLSX.utils.aoa_to_sheet([headers,columns.map(column=>column.label),...rows.map(row=>{const values=payrollDetailValues(batch,row);return columns.map(column=>values[column.key]);})]);
 detail['!merges']=merges;
 detail['!cols']=columns.map(column=>({wch:Math.max(16,column.label.length*2+2)}));
 detail['!autofilter']={ref:`A2:${XLSX.utils.encode_cell({r:rows.length+1,c:columns.length-1})}`};
 rows.forEach((_,index)=>columns.forEach((column,columnIndex)=>{
  const cell=detail[XLSX.utils.encode_cell({r:index+2,c:columnIndex})];
  if(cell?.t==='n')cell.z=monthlyCountFields.has(column.key as keyof LiveMonthly)||column.key==='year'?'0':column.key==='roi'?'0.0000':'0.00';
 }));
 XLSX.utils.book_append_sheet(workbook,detail,'月度核算明细');
 const summary=XLSX.utils.aoa_to_sheet([
  ['月份','员工ID','员工名称','部门名称','总计月薪'],
  ...batch.salaries.map(salary=>[batch.month,salary.employeeId,salary.employeeName,salary.departmentName,salary.total]),
 ]);
 summary['!cols']=Array.from({length:5},()=>({wch:20}));
 batch.salaries.forEach((_,index)=>{summary[XLSX.utils.encode_cell({r:index+1,c:4})].z='0.00';});
 XLSX.utils.book_append_sheet(workbook,summary,'员工月薪汇总');
 return workbook;
}
