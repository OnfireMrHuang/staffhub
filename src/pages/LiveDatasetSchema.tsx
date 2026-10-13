import { Badge, Button, Modal } from '../components';
import TableStructure from './TableStructure';
import type { StructureField } from './TableStructure';
import { detailFields, monthlyFields } from './LiveDatasetFields';

type DatasetTable='details'|'monthly';
const dimension=(name:string,key:string,type:string,note:string):StructureField=>({name,key,type,note,kind:'维度'});
const detailDimensions:StructureField[]=[
 dimension('投放项目编码','projectCode','文本','标识直播记录所属项目，用稳定项目 ID 关联。'),
 dimension('投放项目名称','projectName','文本','项目展示名称，归档后读取冻结快照。'),
 dimension('投放日期','date','日期 YYYY-MM-DD','北京时间的业务日期，用于筛选和期间归属。'),
 dimension('开始时间','start','整点时间 HH:00','时段起点，是时间维度，不是时长。'),
 dimension('结束时间','end','整点时间 HH:00','时段终点，结束可为24:00；与开始组成半开区间。'),
 dimension('主播','hostName / hostId','员工关联 / 姓名','本条直播记录的主播。'),
 dimension('投手','buyerName / buyerId','员工关联 / 姓名','本条直播记录的投手。'),
 dimension('场控','controlName / controlId','员工关联 / 姓名','本条直播记录的场控。'),
];
const monthlyDimensions:StructureField[]=[
 dimension('员工 ID','employeeId','文本标识','月度汇总的员工关联键，同人兼岗不重复记录。'),
 dimension('员工名称','employeeName','文本','员工名称快照，名称变更不改归档结果。'),
 dimension('所属部门','departmentName / departmentId','部门关联','当期部门快照，用于目标部门过滤。'),
 dimension('投放项目编码','projectId → projects.code','文本 / 项目关联','同一员工项目月份只有一条汇总。'),
 dimension('投放项目名称','projectId → projects.name','文本 / 关联展示','来自对应项目及归档快照。'),
 dimension('年份','year','整数年份','期间维度，不能与数值指标相加。'),
 dimension('月份','month','月份 / YYYY-MM','与年份共同确定统计期间，不跨年份合并。'),
 dimension('主播','hostNames','姓名集合','该员工参与记录中的主播名单，投手和场控同样形成员工行。'),
];
const durationKeys=new Set(['hours','nightHours','earlyHours']);
const ratioKeys=new Set(['roi','clickRate','conversionRate']);
const countKeys=new Set(['clicks','conversions','orders','viewers','sessions','nightSessions','earlySessions']);
const notes:Record<string,string>={
 spend:'按直播记录归属汇总直播间消耗，投放基础数据不参与叠加。',
 revenue:'对应营销成交金额；月度总保费采用该金额。',
 clicks:'参与时段的营销点击次数合计。',
 clickRate:'按明确平台分母重算；缺少必要分母时未定义，不直接平均。',
 clickCost:'消耗 ÷ 点击次数，点击次数为零时未定义。',
 conversionRate:'按明确平台转化率分母重算；缺少分母时未定义。',
 conversions:'对应时段转化数合计。',
 conversionCost:'消耗 ÷ 转化数，转化数为零时未定义。',
 roi:'明细为成交金额 ÷ 消耗；月度为总保费 ÷ 总消耗，不平均每日 ROI。',
 orders:'对应时段营销下单数合计。',
 viewers:'对应直播记录范围内的观看人次合计。',
 hours:'按该员工参与记录的结束时间减开始时间累计，同人兼岗只计一次。',
 nightHours:'每天 [02:00,06:00) 内的直播时间跨度合计。',
 earlyHours:'每天 [06:00,08:00) 内的直播时间跨度合计。',
 premium:'参与直播记录的营销成交金额合计，不额外叠加早班系数。',
 nightSpend:'夜班 [02:00,06:00) 内的直播间消耗合计。',
 earlySpend:'早班 [06:00,08:00) 内的直播间消耗合计。',
 hourlySpend:'总消耗 ÷ 总直播时长，单位元/小时；是金额效率指标，不是时间跨度。',
 roiRank:'同项目同月按未舍入 ROI 竞争排名（1、1、3），不可相加或平均。',
 sessions:'同项目同三岗组合连续记录合并场次，每位员工每场只计一次。',
 nightSessions:'合并场次与夜班有正时长交集计一次，不是时长。',
 earlySessions:'合并场次与早班有正时长交集计一次，不是时长。',
};
function indicators(fields:{key:string;label:string}[]):StructureField[]{return fields.map(f=>{
 const duration=durationKeys.has(f.key);
 const type=duration?'时间跨度 / 小时（h）':f.key==='hourlySpend'?'金额效率 / 元每小时':f.key==='roiRank'?'整数名次':countKeys.has(f.key)?`非负整数 / ${f.key.includes('Sessions')||f.key==='sessions'?'场':f.key==='viewers'?'人次':f.key==='orders'?'单':'次'}`:ratioKeys.has(f.key)?f.key==='roi'?'比值':'比例 / 显示百分比':'金额 / 单价（元）';
 return {name:f.label,key:f.key,type,note:notes[f.key],kind:'指标',metricType:duration?'时长指标':'常规指标'};
})}
export default function LiveDatasetSchema({table,open,onClose}:{table:DatasetTable;open:boolean;onClose:()=>void}){
 const dimensions=table==='details'?detailDimensions:monthlyDimensions,metrics=indicators(table==='details'?detailFields:monthlyFields);
 const auxiliary:StructureField[]=table==='details'?[dimension('记录 ID','id','文本标识','对应有效直播记录，作为来源追溯键。'),dimension('记录版本','version','正整数版本','有效记录版本，是系统标识，不作为统计数量。')]:[dimension('参与岗位','roles','角色集合','内部保留主播、投手、场控岗位集合，页面在员工名称下展示。')];
 return <Modal open={open} onOpenChange={v=>{if(!v)onClose()}} title={`${table==='details'?'员工直播数据统计表':'员工直播数据月度汇总表'} · 表结构`} description="固定字段仅可查询。维度描述人员、项目与期间；指标区分时间跨度和常规数值。" wide><div className="live-schema-summary"><Badge tone="gray">结构只读</Badge><p>{table==='details'?'粒度：一条有效直播记录。来源：直播记录 + 同项目、同整小时时段的直播间基础数据。':'粒度：员工 + 项目 + 年月。来源：固定直播统计明细，三岗位分别汇总，兼岗不重复。'}</p></div><div className="schema-category-legend"><span>维度：身份、归属及期间</span><span>时长指标：时间跨度，单位小时</span><span>常规指标：金额、数量、比率及排名</span></div><h3 className="detail-section-title">维度字段 · {dimensions.length} 个</h3><TableStructure fields={dimensions}/><h3 className="detail-section-title">指标字段 · {metrics.length} 个</h3><TableStructure fields={metrics}/><h3 className="detail-section-title">系统关联与辅助字段</h3><TableStructure fields={auxiliary}/><p className="caption">字段分类由系统固定，归档后仍可查询；分类不改变汇总、排名或薪酬计算口径。时耗为常规指标，开始/结束时间为维度。</p><div className="dialog-foot"><Button onClick={onClose}>关闭</Button></div></Modal>;
}
