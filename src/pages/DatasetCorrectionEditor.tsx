import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, Modal, number } from '../components';
import { prepareDetailCorrection, prepareMonthlyCorrection } from '../dataset-corrections';
import type { LiveDetail, LiveMonthly } from '../live-domain';
import { useHub } from '../store';
import { detailFields, monthlyFields } from './LiveDatasetFields';
import { metric } from './LiveFields';

export type CorrectionSelection = {table:'details';row:LiveDetail;key:string;sourceMonth:string;version:number;restore?:boolean} | {table:'monthly';row:LiveMonthly;key:string;sourceMonth:string;version:number;restore?:boolean};
const detailKeys=['productId','roomId','date','start','end','hostId','buyerId','controlId','spend','revenue','clicks','conversions','orders','viewers'];
const monthlyKeys=['employeeId','departmentId','productId','roomId','month','hostNames','hours','nightHours','earlyHours','spend','premium','nightSpend','earlySpend','sessions','nightSessions','earlySessions'];
const detailNumbers=new Set(['spend','revenue','clicks','conversions','orders','viewers']);
const monthlyNumbers=new Set(['hours','nightHours','earlyHours','spend','premium','nightSpend','earlySpend','sessions','nightSessions','earlySessions']);
const counts=new Set(['clicks','conversions','orders','viewers','sessions','nightSessions','earlySessions']);
const detailDerived=new Set(['clickRate','clickCost','conversionRate','conversionCost','roi']);
const monthlyDerived=new Set(['roi','hourlySpend','roiRank']);
const hours=Array.from({length:25},(_,i)=>`${String(i).padStart(2,'0')}:00`);
export default function DatasetCorrectionEditor({selection,onClose}:{selection:CorrectionSelection;onClose:()=>void}){
 const s=useHub(),isDetail=selection.table==='details',row=selection.row;
 const [values,setValues]=useState<Record<string,string|string[]>>(()=>Object.fromEntries((isDetail?detailKeys:monthlyKeys).map(key=>[key,Array.isArray((row as unknown as Record<string,unknown>)[key])?[...((row as unknown as Record<string,unknown>)[key] as string[])]:String((row as unknown as Record<string,unknown>)[key]??'')])));
 const [reason,setReason]=useState(''),[error,setError]=useState('');
 const numeric=isDetail?detailNumbers:monthlyNumbers;
 const patch=useMemo(()=>Object.fromEntries(Object.entries(values).map(([key,value])=>[key,numeric.has(key)?(value===''?NaN:Number(value)):value])),[values,numeric]);
 const preview=useMemo(()=>{try{return {row:isDetail?prepareDetailCorrection(row as LiveDetail,patch,s.employees,s.rooms,s.products):prepareMonthlyCorrection(row as LiveMonthly,patch,s.employees,s.departments,s.rooms,s.products),error:''}}catch(e){return {row:null,error:e instanceof Error?e.message:'请核对修改内容'}}},[isDetail,row,patch,s.employees,s.rooms,s.products,s.departments]);
 const targetMonth=String(isDetail?values.date:values.month).slice(0,7),archived=s.archivedMonths.includes(selection.sourceMonth)||s.archivedMonths.includes(targetMonth),stale=s.dataset.version!==selection.version||s.dataset.revision!==s.revision||s.dataset.month!==s.month;
 const update=(key:string,value:string|string[])=>{setValues(previous=>({...previous,[key]:value}));setError('')};
 const options=(key:string,label:string,items:{id:string;name:string;active?:boolean}[],original:string)=> <label>{label}<select value={String(values[key])} onChange={e=>update(key,e.target.value)}><option value="">请选择</option>{items.map(item=><option key={item.id} value={item.id} disabled={item.active===false&&item.id!==original}>{item.id} · {item.name}{item.active===false?'（已停用）':''}</option>)}</select></label>;
 const staff=s.employees.map(employee=>({...employee,active:employee.status==='在职'}));
 const selectRoom=()=>options('roomId','直播间 ID / 名称',s.rooms.filter(room=>room.productId===values.productId),(row as LiveDetail).roomId);
 const products=<label>产品 ID / 名称<select value={String(values.productId)} onChange={e=>{setValues(previous=>({...previous,productId:e.target.value,roomId:''}));setError('')}}><option value="">请选择</option>{s.products.map(product=><option key={product.id} value={product.id} disabled={!product.active&&product.id!==row.productId}>{product.id} · {product.name}{!product.active?'（已停用）':''}</option>)}</select></label>;
 const numberFields=(isDetail?detailFields:monthlyFields).filter(field=>numeric.has(field.key)).map(field=><label key={field.key}>{field.label}<input type="number" min="0" step={counts.has(field.key)?'1':'any'} value={String(values[field.key])} onChange={e=>update(field.key,e.target.value)}/></label>);
 const save=()=>{setError('');if(!reason.trim()){setError('请填写修改原因');return}try{if(selection.restore)s.restoreDatasetCorrection(selection.table,selection.key,reason,selection.version);else s.saveDatasetCorrection(selection.table,selection.key,patch,reason,selection.version);s.notify(selection.restore?'已恢复自动统计，修订记录已保留。':'已保存人工修正，计算指标已重算。');onClose()}catch(e){setError(e instanceof Error?e.message:'操作未完成，请核对数据')}};
 const previewFields:ReactNode=preview.row&&(isDetail?detailFields:monthlyFields).filter(field=>(isDetail?detailDerived:monthlyDerived).has(field.key)).map(field=><div key={field.key}><span>{field.label}</span><strong>{field.key==='roiRank'?'保存后按同直播间同月重排':isDetail?metric((preview.row as LiveDetail)[field.key as keyof LiveDetail],field.key):typeof (preview.row as LiveMonthly)[field.key as keyof LiveMonthly]==='number'?number((preview.row as LiveMonthly)[field.key as keyof LiveMonthly] as number,2):'未定义'}</strong></div>);
 return <Modal open onOpenChange={open=>{if(!open)onClose()}} title={selection.restore?'恢复自动统计':isDetail?'修正直播统计明细':'修正员工月度汇总'} description={`${isDetail?`记录 ${String((row as LiveDetail).id)} · 来源版本 ${(row as LiveDetail).version}`:`${(row as LiveMonthly).employeeName} · ${row.roomName} · ${(row as LiveMonthly).month}`} · 统计快照 v${selection.version}`} wide>
 <form onSubmit={e=>{e.preventDefault();save()}} className="dataset-correction-form">
 {selection.restore?<div className="warning-box">恢复后移除本行人工覆盖，重新采用当前自动统计结果。原始来源及历史修订记录会保留。</div>:<>
 <div className="dataset-correction-note"><Badge tone="amber">人工修正</Badge><p>关联名称由目录自动带出。保存仅修正统计结果；刷新固定统计后仍保留修正。</p></div>
 <h3>关联与期间</h3><div className="form-grid">
 {!isDetail&&options('employeeId','员工 ID / 姓名',staff,(row as LiveMonthly).employeeId)}
 {!isDetail&&options('departmentId','当期所属部门',s.departments,(row as LiveMonthly).departmentId)}
 {products}{selectRoom()}
 {isDetail?<><label>投放日期<input type="date" value={String(values.date)} onChange={e=>update('date',e.target.value)}/></label><label>开始时间<select value={String(values.start)} onChange={e=>update('start',e.target.value)}>{hours.slice(0,24).map(hour=><option key={hour}>{hour}</option>)}</select></label><label>结束时间<select value={String(values.end)} onChange={e=>update('end',e.target.value)}>{hours.slice(1).map(hour=><option key={hour}>{hour}</option>)}</select></label>{options('hostId','主播 ID / 姓名',staff,(row as LiveDetail).hostId)}{options('buyerId','投手 ID / 姓名',staff,(row as LiveDetail).buyerId)}{options('controlId','场控 ID / 姓名',staff,(row as LiveDetail).controlId)}</>:<><label>统计月份<input type="month" value={String(values.month)} onChange={e=>update('month',e.target.value)}/></label><label>年份（自动）<input readOnly value={String(values.month).slice(0,4)}/></label></>}
 </div>
 {!isDetail&&<><p className="caption">部门用于本月统计及计薪归属，可与员工当前基础档案不同。</p><fieldset className="dataset-host-picker"><legend>相关主播（选择已有员工）</legend><div>{staff.map(employee=><label key={employee.id}><input type="checkbox" checked={(values.hostNames as string[]).includes(employee.name)} disabled={!employee.active&&!(row as LiveMonthly).hostNames.includes(employee.name)} onChange={e=>update('hostNames',e.target.checked?[...new Set([...(values.hostNames as string[]),employee.name])]:(values.hostNames as string[]).filter(name=>name!==employee.name))}/><span>{employee.name} <small>{employee.id}{!employee.active?' · 非在职':''}</small></span></label>)}</div></fieldset></>}
 {targetMonth!==selection.sourceMonth&&<div className="warning-box">此修正将统计行从 {selection.sourceMonth} 移至 {targetMonth||'所选月份'}；原始录入来源不会移动。</div>}
 <h3>基础指标</h3><div className="form-grid">{numberFields}</div>
 <p className="caption">{isDetail?'时段不变时，修改消耗保留原来源夜班 / 早班消耗比例；修改时段后按班次时长分配。':'总量和夜班 / 早班数据可分别修正；班次时长、消耗及场次不能超过对应总量。'}</p>
 <h3>计算预览 · 自动只读</h3><div className="dataset-correction-preview">{previewFields||<p>关联及基础指标有效后显示预览。</p>}</div>
 {preview.error&&<div className="error-box" role="alert">{preview.error}</div>}
 </>}
 {archived&&<div className="error-box" role="alert">原月份或目标月份已归档，不能修改或恢复自动。</div>}
 {stale&&<div className="warning-box">统计已发生变化。请关闭弹窗并刷新统计后重新打开，避免覆盖较新的修订。</div>}
 <label>{selection.restore?'恢复原因':'修改原因'}<textarea aria-required="true" value={reason} onChange={e=>{setReason(e.target.value);setError('')}} placeholder="说明核对依据与修正原因" rows={3}/></label>
 {error&&<div className="error-box" role="alert">{error}</div>}
 <div className="dialog-foot"><Button onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={archived||stale||(!selection.restore&&!!preview.error)}>{selection.restore?'确认恢复自动':'保存修正'}</Button></div>
 </form></Modal>;
}
