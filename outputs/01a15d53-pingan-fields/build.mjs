import fs from 'node:fs/promises';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';

const out = '/Users/huangwenwu/meimei/staffhub/outputs/01a15d53-pingan-fields';
const source = '/Users/huangwenwu/meimei/staffhub/artifacts/pingan_crawler/20261021_152733_021185';
const s = JSON.parse(await fs.readFile(`${source}/snapshot.json`, 'utf8'));
const wb = Workbook.create();
const metrics = [
 ['GMV简易ROI','gmvSimpleRoi','倍','脚本固定显示“-”。本次接口值为空。'],
 ['业绩ROI','performanceRoi','倍','脚本固定显示“-”。本次接口值为空。'],
 ['投放消耗(元)','未映射','元','脚本固定显示“-”，未读取对应接口字段。'],
 ['保单数（件）','validPolicyCnt','件','直接使用接口返回的保单数。'],
 ['年化保费（元）','annualPremium','元','接口原值153260.28，脚本四舍五入为整数。'],
 ['订单数（件）','orderCnt','件','今日汇总接口返回值，不能直接等同于订单明细条数。'],
 ['绑卡率（%）','calcBindCardRate（派生）','%','bindPolicyCnt ÷ validPolicyCnt × 100%；保留2位小数。'],
 ['保单退保率（%）','calcSurrenderRate（派生）','%','surrenderPolicyCnt ÷ validPolicyCnt × 100%；保留2位小数。'],
 ['当日投保保费（元）','undwrtPremium','元','接口原值18222.19，脚本四舍五入为整数。'],
 ['当日投保保费-年缴（元）','undwrtPremiumAnnual','元','直接使用接口返回的年缴投保保费。'],
 ['当日投保保费-月缴（元）','undwrtPremiumMonthly','元','直接使用接口返回的月缴投保保费。'],
 ['年缴单占比（%）','annualPolRate（派生）','%','annualPolicyCnt ÷ validPolicyCnt × 100%；保留2位小数。'],
 ['多人单占比（%）','multiApplicantPolRate（派生）','%','multiApplicantCnt ÷ allApplicantCnt × 100%；保留2位小数。'],
 ['绑卡保单数（件）','bindPolicyCnt','件','直接使用接口返回的绑卡保单数。'],
 ['外层点击率','ctr','%','接口直接返回百分数；本次为空，脚本显示“/”。'],
 ['超一分钟观看率','liveDuration60sUCountToLiveWatchUCountRate','%','接口直接返回百分数；本次为空，脚本显示“/”。'],
 ['组件点击率','liveComponentCtr','%','接口直接返回百分数；本次为空，脚本显示“/”。'],
 ['订单提交率','orderCommitRate','%','接口直接返回百分数；本次为空，脚本显示“/”。'],
 ['保单转化率','policyTransRate','%','接口返回25.84，脚本追加百分号；未在本地计算分母。'],
];
const mrows=metrics.map(([label,field,unit,note],i)=>{
 const v=(i<14?s.displayMetrics:s.displayFunnel)[label];
 if(v===undefined) throw new Error(`缺少指标 ${label}`);
 const english=field==='未映射'?'adSpend':field.replace('（派生）','');
 const types=['string','string','string','integer','number','integer','string','string','number','number','number','string','string','integer','string','string','string','string','string'];
 if(i===2)note+=' adSpend为建议英文名，尚无已确认接口映射。';
 if(field.includes('派生'))note='脚本派生字段，输出百分比字符串。'+note;
 return [i+1,i<14?'数据概况':'漏斗数据',label,english,unit,typeof v==='string'&&v.endsWith('%')?parseFloat(v)/100:v,note,types[i]];
});
const orows=[
 [1,'列表','orderGroup','string','待支付 / 已支付','orderGroup为采集分组建议英文名，非接口字段。待支付组：10、20；已支付组：21、30、100。'],
 [2,'产品','itemName','文本','平安e生保·长期医疗产品组合','订单对应的产品名称。'],
 [3,'订单状态','orderStatus','枚举 → 中文','20 → 待支付','1新建；10审核中；20待支付；21已支付；30已确认；90已超时；99已关闭；100已完成。'],
 [4,'下单时间','orderTime','日期时间','2026-10-21 15:26:46','订单创建时间，CSV保留接口时间字符串。'],
 [5,'更新时间','updatedDate','日期时间','YYYY-MM-DD HH:mm:ss','订单更新时间；查询区间依据此字段，按更新时间倒序。'],
 [6,'保费','actualAmount','金额（元）',120.04,'接口返回金额，不是年化保费；需结合缴费方式理解。'],
 [7,'缴费方式','premType','枚举 → 中文','2 → 月缴','字符串编码：2月缴；5年缴；1趸缴。未知值保留原值。'],
 [8,'投保人','applicant.name','文本','任先生','投保人姓名，保留接口返回的脱敏形式。'],
 [9,'投保人年龄','applicant.age','年龄（岁）',36,'取applicant对象内的age字段；空值导出为空。'],
 [10,'被保人','insurantList','JSON数组','见字段说明','一单可含多人。对象字段：name、age、ageGroup、socialSecurity、relationshipWithApplicant、planProduct。CSV中序列化为JSON文本。'],
 [11,'postId','postId','标识符（文本）','原值保留','接口返回的postId。业务唯一性尚未验证，不直接视为保单号。'],
];
const orderTypes=['string','string','integer','string (datetime)','string (datetime)','string (decimal)','string','string','string (integer)','array<object>','string'];
orows.forEach((r,i)=>r[3]=orderTypes[i]);
orows[10][1]='接口标识（postId）';
orows[2][5]+=' 接口为整数编码，导出为中文文本。';
orows[5][5]+=' 接口为金额字符串。';
orows[8][5]+=' 接口为整数字符串，单位为岁。';

function setup(name,title,context,headers,rows,widths,tableName){
 const sh=wb.worksheets.add(name); sh.showGridLines=false;
 const last=String.fromCharCode(64+headers.length), end=6+rows.length;
 sh.getRange(`A1:${last}${end}`).format.font={name:'Arial',size:11,color:'#243247'};
 sh.getRange(`A1:${last}${end}`).format.verticalAlignment='center';
 sh.getRange('A2').values=[[title]];
 sh.getRange('A2').format.font={name:'Arial',size:16,bold:true,color:'#17365D'};
 sh.getRange(`A2:${last}2`).format.borders={bottom:{style:'thin',color:'#9AAAC0'}};
 sh.getRange(`A2:${last}2`).format.rowHeight=30;
 sh.getRange('A3').values=[[context]];
 sh.getRange('A4').values=[['来源：平安健康险开放平台看板；2026-10-21 15:27采集；字段映射依据 pingan_collect.py。']];
 sh.getRange(`A3:${last}4`).format.font={name:'Arial',size:11,color:'#667085'};
 sh.getRange(`A3:${last}4`).format.rowHeight=23;
 sh.getRange(`A6:${last}${end}`).values=[headers,...rows];
 sh.tables.add(`A6:${last}${end}`,true,tableName);
 sh.getRange(`A6:${last}6`).format={fill:'#17365D',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},horizontalAlignment:'center',verticalAlignment:'center',rowHeight:30};
 sh.getRange(`A7:${last}${end}`).format.rowHeight=48;
 sh.getRange(`A7:${last}${end}`).format.wrapText=true;
 for(let i=0;i<widths.length;i++)sh.getRange(`${String.fromCharCode(65+i)}1:${String.fromCharCode(65+i)}${end}`).format.columnWidthPx=widths[i];
 for(let r=7;r<=end;r++)if(r%2===1)sh.getRange(`A${r}:${last}${r}`).format.fill='#F1F5F9';
 sh.getRange(`A7:A${end}`).format.horizontalAlignment='center';
 sh.freezePanes.freezeRows(6);
 return sh;
}
const ms=setup('统计指标','平安保单统计指标','统计日期：2026-10-21（今日）。“-”为占位符，“/”为未展示有效值，均不等同于0。',
 ['序号','分区','字段中文名','字段英文名','单位','采集值','统计口径 / 字段说明','字段数据类型'],mrows,[50,90,240,305,55,110,490,140],'PinganMetrics');
ms.getRange('A5').values=[['数据类型按本次接口原值标注；派生字段按脚本输出标注。Excel采集值中的百分比使用数值格式。']];
ms.getRange('A5').format.font={name:'Arial',size:11,color:'#667085'};
metrics.forEach((m,i)=>{
 const v=mrows[i][5]; const cell=ms.getRange(`F${i+7}`);
 if(typeof v==='number')cell.setNumberFormat(m[2]==='%'?'0.00%':m[2]==='元'?'#,##0.00':'#,##0');
 cell.format.horizontalAlignment='right';
});
const os=setup('订单表头','平安订单表头说明','与 orders.csv 的11列表头顺序一致。查询区间：2026-10-20 23:00 至 2026-10-21 15:27:33（北京时间）。',
 ['序号','字段中文名','字段英文名','字段数据类型','示例 / 格式','字段说明 / 枚举'],orows,[50,170,250,160,285,470],'PinganOrderHeaders');
os.getRange('A5').values=[['数据类型按本次接口原值标注。string括号内标明内容格式；被保人在CSV中导出为JSON文本。']];
os.getRange('A5').format.font={name:'Arial',size:11,color:'#667085'};
os.getRange('A9:F9').format.rowHeight=66;
os.getRange('A16:F16').format.rowHeight=82;
os.getRange('E12').setNumberFormat('0.00');
wb.recalculate();
if(ms.getRange('A7:H25').values.length!==19||os.getRange('A7:F17').values.length!==11)throw new Error('行数不符');
for(const sh of [ms,os]){
 const grid=sh.getRange(sh===ms?'A6:H25':'A6:F17').values;
 for(const header of ['字段中文名','字段英文名','字段数据类型']){
  const c=grid[0].indexOf(header);
  if(c<0||grid.slice(1).some(r=>!r[c]))throw new Error(`缺少必填列或内容：${header}`);
 }
}
console.log((await wb.inspect({kind:'table',range:'统计指标!A6:G10',tableMaxRows:5,tableMaxCols:7,maxChars:2000})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:20},maxChars:1000})).ndjson);
for(const sh of ['统计指标','订单表头']){
 const preview=await wb.render({sheetName:sh,range:sh==='统计指标'?'A1:H25':'A1:F17',scale:1,format:'png'});
 await fs.writeFile(`${out}/${sh}.png`,new Uint8Array(await preview.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(`${out}/平安统计指标与订单表头.xlsx`);
console.log('已导出：19项指标，11个订单字段，2张工作表。');
