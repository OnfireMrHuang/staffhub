import { Badge, Button, Modal } from '../components';
import { adFields, roomFields } from './LiveFields';
import TableStructure from './TableStructure';
import type { StructureField } from './TableStructure';

type InputModel='records'|'ad'|'room';
type Field=StructureField;
const field=(name:string,key:string,type:string,note:string):Field=>({name,key,type,note,kind:'维度'});
const measure=(name:string,key:string,type:string,note:string):Field=>({name,key,type,note,kind:'指标',metricType:'常规指标'});
const recordFields:Field[]=[
 field('投放项目编码','projectId → projects.code','文本 / 项目关联','按唯一项目编码匹配；不要求项目关联员工。'),
 field('投放项目名称','projectId → projects.name','文本 / 关联展示','与项目编码一致，名称不作为关联主键。'),
 field('投放日期','date','日期 YYYY-MM-DD','北京时间业务日期；已归档月份不能写入。'),
 field('开始时间','start','整点时间 HH:00','00:00–23:00，与结束时间构成半开区间。'),
 field('结束时间','end','整点时间 HH:00','01:00–24:00，晚于开始；跨日按日期分行。'),
 field('主播','hostId','员工关联 / 姓名输入','必填唯一员工姓名，写入时解析稳定员工 ID。'),
 field('投手','buyerId','员工关联 / 姓名输入','必填；可与其他岗位兼任，同人统计不重复记录。'),
 field('场控','controlId','员工关联 / 姓名输入','必填；写入统一检查在职及明确入职日期。'),
];
const systemFields:Field[]=[field('记录 ID','id','文本标识','系统生成；编辑保留原 ID。'),field('记录版本','version','正整数','直播记录更正递增版本，避免覆盖已更新记录。')];
const hourlyCommon:Field[]=[field('投放项目','projectId','项目关联','按项目 ID 关联，页面展示项目编码及名称。'),field('投放日期','date','日期 YYYY-MM-DD','小时区间的北京时间日期，系统辅助字段。'),field('开始时间','start','整点时间 HH:00','每条基础记录对应一个完整小时。'),field('结束时间','end','整点时间 HH:00','相邻小时首尾衔接，结束可为 24:00。')];
function metrics(fields:{key:string;label:string}[]):Field[]{return fields.map(f=>{
 const rate=f.key.endsWith('Rate'),cost=['spend','payment','revenue','conversionCost','clickCost'].includes(f.key);
 return {...field(f.label,f.key,rate?'比例 / 页面显示百分比':f.key==='roi'?'比值':cost?'金额 / 单价（元）':'非负整数',rate?'保留平台口径；聚合须有明确分母，不直接求和或平均。':f.key==='roi'?'保留平台营销 ROI；员工汇总按成交金额和消耗重算。':cost?'保留来源金额及精度，展示舍入不改变计算依据。':'按项目、账户及小时区间保存，重复同步不累加。'),kind:'指标',metricType:'常规指标'};
})}
const names={records:'直播记录表',ad:'投放基础数据',room:'直播间基础数据'};
export default function LiveSchema({model,open,onClose}:{model:InputModel;open:boolean;onClose:()=>void}){
 const fields=model==='records'?recordFields:[...hourlyCommon,...(model==='room'?[field('直播账户 ID','accountId','文本标识','项目可有多个账户，每个账户分别保存小时数据。')]:[]),...metrics(model==='ad'?adFields:roomFields)];
 const system=model==='records'?systemFields:[systemFields[0],...(model==='room'?[measure('营销点击率分母','clickRateDenominator','可选数值 / 系统辅助','由平台适配器明确提供；缺失时多小时汇总点击率未定义。'),measure('转化率分母','conversionRateDenominator','可选数值 / 系统辅助','由平台适配器明确提供；不以未经确认的指标代替。')]:[])];

 return <Modal open={open} onOpenChange={v=>{if(!v)onClose()}} title={`${names[model]} · 表结构`} description="字段及输入约束由系统固定，仅可查看，不提供字段配置。" wide><div className="live-schema-summary"><Badge tone="gray">结构只读</Badge><p>{model==='records'?'来源：模板上传 / 表单录入 / 编辑。业务粒度：项目 + 日期 + 不重叠的整小时时段。':'来源：关联平台接口按全天逐小时取数；本 DEMO 使用模拟小时来源。业务粒度：项目 + '+(model==='room'?'直播账户 + ':'投放账户 + ')+'日期 + 小时区间。'}</p></div><h3 className="detail-section-title">固定业务字段</h3><TableStructure fields={fields}/><h3 className="detail-section-title">系统关联与辅助字段</h3><TableStructure fields={system}/><p className="caption">以上标识对应 DEMO 数据模型；正式物理表还保留采集或录入批次、有效版本及审计信息。归档限制不影响查看表结构。</p><div className="dialog-foot"><Button onClick={onClose}>关闭</Button></div></Modal>;
}
