import { Badge, Button, Modal } from '../components';
import TableStructure from './TableStructure';
import type { StructureField } from './TableStructure';
import { detailFields, monthlyFields, monthlyDimensions as monthlyDimensionFields } from './LiveDatasetFields';

type DatasetTable='details'|'monthly';
const dimension=(name:string,key:string,type:string,note:string):StructureField=>({name,key,type,note,kind:'维度'});
const detailDimensions:StructureField[]=[
 dimension('产品ID','productId → products.id','文本 / 产品关联','稳定产品 ID，标识直播间关联的投放产品。'),
 dimension('产品名称','productName','文本','产品名称快照，归档后读取冻结依据。'),
 dimension('直播间ID','roomId → rooms.id','文本 / 直播间关联','稳定直播间 ID，关联记录和该直播间的小时来源。'),
 dimension('直播间名称','roomName','文本','直播间展示名称，归档后读取冻结依据。'),
 dimension('投放日期','date','日期 YYYY-MM-DD','北京时间的业务日期，用于筛选和期间归属。'),
 dimension('开始时间','start','整点时间 HH:00','时段起点，是时间维度，不是时长。'),
 dimension('结束时间','end','整点时间 HH:00','时段终点，结束可为24:00；与开始组成半开区间。'),
 dimension('主播','hostName / hostId','员工关联 / 姓名','本条直播记录的主播。'),
 dimension('投手','buyerName / buyerId','员工关联 / 姓名','本条直播记录的投手。'),
 dimension('场控','controlName / controlId','员工关联 / 姓名','本条直播记录的场控。'),
];
const dimensionNotes:Record<string,string>={employeeId:'员工关联键；主播、投手、场控分别汇总，兼岗去重。',employeeName:'员工姓名快照。',departmentId:'当期统计部门ID，可通过关联编辑修正。',departmentName:'当期部门名称快照。',employeeJoinedOn:'员工档案的入职日期快照，未维护时未定义。',nonCompeteSigned:'员工档案是否签约竞业协议的布尔快照，新统计缺省false；历史归档缺失时不回填。',productId:'关联产品ID。',productName:'关联产品名称快照。',roomId:'关联直播间ID。',roomName:'直播间名称快照。',roomOpenedOn:'直播间配置中的开播日期快照，当前精度为日期，不猜测具体时刻。',year:'统计年份。',month:'统计月份，与年份共同组成期间。'};
const monthlyDimensions:StructureField[]=monthlyDimensionFields.map(field=>dimension(field.label,field.key,field.key==='nonCompeteSigned'?'布尔值':field.key==='employeeJoinedOn'||field.key==='roomOpenedOn'?'日期 YYYY-MM-DD':field.key==='year'?'整数年份':field.key==='month'?'月份 YYYY-MM':'文本 / 关联快照',dimensionNotes[field.key]));
const durationKeys=new Set(['hours','nightHours','earlyHours','regularHours']);
const ratioKeys=new Set(['roi','clickRate','conversionRate']);
const countKeys=new Set(['clicks','conversions','orders','viewers','sessions','nightSessions','earlySessions']);
const notes:Record<string,string>={
 spend:'按直播记录归属汇总对应直播间的消耗。',
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
 regularHours:'总直播时长 − 夜班时长 − 早班时长，自动重算；旧冻结数据缺失时显示未定义。',
 nightPremium:'夜班 [02:00,06:00) 实际小时成交金额合计；可填写已核验的月度金额，未知不按时长猜分。',
 regularSpend:'总消耗 − 夜班消耗 − 早班消耗，自动重算。',
 adCost:'字段预留；来源与计算口径待后续梳理，当前显示待定义，不猜测计算或开放录入。',
 policyCost:'字段预留；来源与计算口径待后续梳理，当前显示待定义，不猜测计算或开放录入。',
 spendRank:'同直播间同月按总消耗降序竞争排名（1、1、3），含零消耗，按完整数据排名后再筛选。',
 earlyPremium:'早班 [06:00,08:00) 实际小时成交金额合计；可修正月度基础值，不按时长猜分。旧数据缺失时未定义。',
 regularPremium:'总保费 − 夜班保费 − 早班保费；自动重算，任一班次金额未知时未定义。',
 premium:'参与直播记录的营销成交金额合计，不额外叠加早班系数。',
 nightSpend:'夜班 [02:00,06:00) 内的直播间消耗合计。',
 earlySpend:'早班 [06:00,08:00) 内的直播间消耗合计。',
 hourlySpend:'总消耗 ÷ 总直播时长，单位元/小时；是金额效率指标，不是时间跨度。',
 roiRank:'同直播间同月按未舍入 ROI 竞争排名（1、1、3），不可相加或平均。',
 sessions:'同直播间同三岗组合连续记录合并场次，每位员工每场只计一次。',
 nightSessions:'合并场次与夜班有正时长交集计一次，不是时长。',
 earlySessions:'合并场次与早班有正时长交集计一次，不是时长。',
};
function indicators(fields:{key:string;label:string}[]):StructureField[]{return fields.map(f=>{
 const duration=durationKeys.has(f.key);
 const type=duration?'时间跨度 / 小时（h）':f.key==='hourlySpend'?'金额效率 / 元每小时':['roiRank','spendRank'].includes(f.key)?'整数名次':countKeys.has(f.key)?`非负整数 / ${f.key.includes('Sessions')||f.key==='sessions'?'场':f.key==='viewers'?'人次':f.key==='orders'?'单':'次'}`:ratioKeys.has(f.key)?f.key==='roi'?'比值':'比例 / 显示百分比':'金额 / 单价（元）';
 return {name:f.label,key:f.key,type,note:notes[f.key],kind:'指标',metricType:duration?'时长指标':'常规指标'};
})}
export default function LiveDatasetSchema({table,open,onClose,notice}:{table:DatasetTable;open:boolean;onClose:()=>void;notice?:string}){
 const dimensions=table==='details'?detailDimensions:monthlyDimensions,metrics=indicators(table==='details'?detailFields:monthlyFields);
 const auxiliary:StructureField[]=table==='details'?[dimension('记录 ID','id','文本标识','对应有效直播记录，作为来源追溯键。'),dimension('来源版本','version','正整数版本','原始直播记录版本，统计人工修正不增加该来源版本。')]:[dimension('参与岗位','roles','角色集合','内部保留主播、投手、场控岗位集合，用于内部追溯，不作为当前业务表列。')];
 return <Modal open={open} onOpenChange={v=>{if(!v)onClose()}} title={`${table==='details'?'员工直播数据统计表':'员工直播数据月度汇总表'} · 表结构`} description="字段结构仅可查询；未归档且统计有效时，可修正行的关联与基础指标，名称自动带出，计算指标只读。" wide>{notice&&<div className="warning-box">{notice}</div>}<div className="live-schema-summary"><Badge tone="gray">结构只读</Badge><Badge tone="amber">行数据可修正</Badge><p>{table==='details'?'粒度：一条有效直播记录。来源：直播记录 + 同产品、同直播间、同整小时时段的直播间基础数据。':'粒度：员工 + 直播间 + 年月。来源：原始统计 → 时报 → 团队日报 → 月度；未绑定报表定义的直播间沿用原始统计兼容来源，独立月度人工覆盖最终优先。三岗位分别汇总，兼岗不重复。'}</p></div><div className="schema-category-legend"><span>维度：身份、归属及期间</span><span>时长指标：时间跨度，单位小时</span><span>常规指标：金额、数量、比率及排名</span></div><h3 className="detail-section-title">维度字段 · {dimensions.length} 个</h3><TableStructure fields={dimensions}/><h3 className="detail-section-title">指标字段 · {metrics.length} 个</h3><TableStructure fields={metrics}/><h3 className="detail-section-title">系统关联与辅助字段</h3><TableStructure fields={auxiliary}/><p className="caption">关联与基础指标通过行编辑修正；正常消耗、正常保费、正常直播时长、ROI、时耗、排名及率与单价由系统自动重算。字段分类由系统固定，归档后仍可查询；分类不改变汇总、排名或薪酬计算口径。时耗为常规指标，开始/结束时间为维度。</p><div className="dialog-foot"><Button onClick={onClose}>关闭</Button></div></Modal>;
}
