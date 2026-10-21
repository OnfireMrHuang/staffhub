import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const outputDir = new URL('.', import.meta.url).pathname;
const fields = [
 ['产品 ID','product_id','VARCHAR(64)','业务字段，必填。关联 advertising_products.id，须与直播间所属产品一致。以文本保存稳定 ID。'],
 ['产品名称','product_name','VARCHAR(200)','业务字段，必填。录入时须与产品 ID 对应名称一致。建议保存录入时名称快照，归档后不随当前名称变化。'],
 ['直播间 ID','room_id','VARCHAR(64)','业务字段，必填。关联 live_rooms.id。每条记录仅属于一个直播间，统计和薪酬按此 ID 关联。'],
 ['直播间名称','room_name','VARCHAR(200)','业务字段，必填。录入时须与直播间 ID 对应名称一致。建议保存录入时名称快照，归档后不随当前名称变化。'],
 ['投放日期','live_date','DATE','业务字段，必填。实际直播时段所属的北京时间业务日期，展示格式 YYYY-MM-DD，须为有效日历日期。'],
 ['开始时间','start_time','CHAR(5)','业务字段，必填。格式 HH:00，范围 00:00～23:00。采用五位文本便于与模板一致，写入时须校验整点。'],
 ['结束时间','end_time','CHAR(5)','业务字段，必填。格式 HH:00，范围 01:00～24:00，须晚于开始时间。24:00 表示次日零点，文本类型避免数据库 TIME 对 24:00 的兼容差异。'],
 ['主播','host_name','VARCHAR(100)','业务字段，必填。主播姓名快照。按统一规则规范化后精确匹配唯一员工，并保存 host_id；不做模糊匹配。'],
 ['投手','buyer_name','VARCHAR(100)','业务字段，必填。投手姓名快照。按统一规则规范化后精确匹配唯一员工，并保存 buyer_id；不做模糊匹配。'],
 ['场控','control_name','VARCHAR(100)','业务字段，必填。场控姓名快照。按统一规则规范化后精确匹配唯一员工，并保存 control_id；不做模糊匹配。'],
 ['内部记录 ID','id','VARCHAR(64)','系统字段，必填，主键。系统生成且全局唯一。编辑通过此 ID 更新记录的有效版本，不要求用户填写。'],
 ['主播员工 ID','host_id','VARCHAR(64)','系统字段，必填。由主播姓名解析，关联 employees.id。后续统计使用稳定员工 ID，员工改名不重写归档姓名快照。'],
 ['投手员工 ID','buyer_id','VARCHAR(64)','系统字段，必填。由投手姓名解析，关联 employees.id。允许与其他岗位为同一员工，个人统计不得重复计算本记录。'],
 ['场控员工 ID','control_id','VARCHAR(64)','系统字段，必填。由场控姓名解析，关联 employees.id。允许与其他岗位为同一员工，个人统计不得重复计算本记录。'],
 ['记录版本','version','INT','系统字段，必填。正整数，建议默认 1，每次更新递增，用于并发控制及追溯。归档保存所引用版本。'],
 ['来源批次 ID','source_batch_id','VARCHAR(64)','系统字段。标识本次上传或录入的来源批次，用于追溯。建议所有写入入口统一生成批次 ID，同批记录共享该值。'],
 ['有效状态','is_valid','BOOLEAN','系统字段，必填。标识记录是否有效，建议默认 TRUE。统计仅使用有效记录；状态变更同样受归档校验约束。'],
 ['创建人 ID','created_by','VARCHAR(64)','系统字段，必填。创建记录的操作账号稳定 ID，由系统写入，不等同于主播或其他岗位人员 ID。'],
 ['创建时间','created_at','DATETIME(3)','系统字段，必填。系统记录创建时间，精确到毫秒。本设计统一使用北京时间（Asia/Shanghai）存取语义。'],
 ['修改人 ID','updated_by','VARCHAR(64)','系统字段，必填。最近一次修改记录的操作账号稳定 ID。建议创建时初始化为 created_by。'],
 ['修改时间','updated_at','DATETIME(3)','系统字段，必填。最近一次修改时间，精确到毫秒。建议创建时初始化为 created_at，更新时由系统刷新。'],
];
const notes = [
 ['时间与跨日','时段采用半开区间 [开始时间, 结束时间)。跨日记录按北京时间日期拆分保存，每一天均检查归档状态。'],
 ['重复与交叠','同直播间有效记录不得重复或交叠。建议唯一键 (room_id, live_date, start_time, end_time)，并在事务中校验区间重叠；唯一键不能单独防止交叠。'],
 ['索引建议','主键 id；建议索引 (room_id, live_date, start_time, end_time)、(product_id, live_date)，以及三类员工 ID。更新按 id + version 做并发校验。'],
 ['人员与批量校验','三岗位均须填写，员工须在职且入职日期不晚于直播日期。DEMO 入职日期为空时提示待维护并允许录入。上传整批校验、整批写入。'],
 ['归档限制','已归档月份禁止写入。编辑同时检查原日期及目标日期，防止移出归档月；任一行失败则整批拒绝，返回行号、字段和原因。'],
 ['场次与数据范围','同直播间、同三岗人员组合的连续区间合并为一场，包含午夜相连区间。时长、场次及经营指标属于统计结果，不另加为本表原始字段。'],
];
const wb = Workbook.create();
const sh = wb.worksheets.add('直播记录表结构');
sh.showGridLines = false;
sh.getRange('A1:D35').format.font = {name:'Arial',size:11,color:'#203047'};
sh.getRange('A1:D35').format.verticalAlignment = 'center';
sh.getRange('A1:D35').format.rowHeight = 26;
sh.getRange('A1:A35').format.columnWidth = 21;
sh.getRange('B1:B35').format.columnWidth = 24;
sh.getRange('C1:C35').format.columnWidth = 22;
sh.getRange('D1:D35').format.columnWidth = 94;
sh.getRange('A1').values = [['直播记录表结构']];
sh.getRange('A1').format.font = {name:'Arial',size:16,bold:true,color:'#17365D'};
sh.getRange('A1:D1').format.rowHeight = 34;
sh.getRange('A2').values = [['物理表：live_records　　10 个业务字段 + 11 个系统字段　　整理日期：2026-10-21']];
sh.getRange('A3').values = [['依据：docs/superpowers/specs/2026-10-09-staffhub-phase-one-design.md，第 7.1～7.3 节、第 11.3 节、第 12 节。']];
sh.getRange('A4').values = [['英文名、SQL 类型、长度及标注“建议”的默认值为设计建议，非现有数据库 DDL；业务约束以产品说明为准。']];
sh.getRange('A3:D4').format.font = {name:'Arial',size:10,color:'#64748B'};
sh.getRange('A6:D6').values = [['字段中文名','字段英文名','字段类型','字段描述']];
sh.getRange('A7:D27').values = fields;
sh.tables.add('A6:D27',true,'LiveRecordSchema');
sh.getRange('A6:D6').format = {fill:'#233F63',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},horizontalAlignment:'center',verticalAlignment:'center',rowHeight:30};
sh.getRange('A7:D27').format.rowHeight = 52;
sh.getRange('A7:D27').format.wrapText = true;
for(let r=7;r<=27;r++) sh.getRange(`A${r}:D${r}`).format.fill = r%2 ? '#FFFFFF' : '#F1F5F9';
sh.getRange('A17:D17').format.borders = {top:{style:'medium',color:'#A7B8CC'}};
sh.getRange('B7:C27').format.font = {name:'Arial',size:11,color:'#24496F'};
sh.getRange('A29').values = [['表级约束与设计说明']];
sh.getRange('A29').format.font = {name:'Arial',size:13,bold:true,color:'#17365D'};
notes.forEach(([title,desc],i)=>{
 const row=30+i;
 sh.getRange(`A${row}`).values=[[title]];
 sh.getRange(`D${row}`).values=[[desc]];
 sh.getRange(`A${row}`).format.font={name:'Arial',size:11,bold:true,color:'#334155'};
 sh.getRange(`D${row}`).format.wrapText=true;
 sh.getRange(`A${row}:D${row}`).format.rowHeight=58;
});
sh.freezePanes.freezeRows(6);
if(fields.length!==21 || new Set(fields.map(r=>r[1])).size!==21 || fields.some(r=>r.length!==4||r.some(x=>!x))) throw new Error('Field validation failed');
wb.recalculate();
console.log((await wb.inspect({kind:'table',range:'直播记录表结构!A6:D10',include:'values',tableMaxRows:5,tableMaxCols:4,maxChars:2400})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:20},summary:'Error scan'})).ndjson);
for(const [name,range] of [['preview-top','A1:D17'],['preview-bottom','A18:D35']]) {
 const preview=await wb.render({sheetName:sh.name,range,scale:1.5,format:'png'});
 await fs.writeFile(`${outputDir}/${name}.png`,new Uint8Array(await preview.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(`${outputDir}/直播记录表结构.xlsx`);
console.log(JSON.stringify({output:`${outputDir}/直播记录表结构.xlsx`,fields:fields.length,columns:4}));
