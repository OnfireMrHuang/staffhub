import fs from 'node:fs/promises';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';
const dir = new URL('.', import.meta.url).pathname;
const data = JSON.parse(await fs.readFile(dir+'fields.json','utf8'));
const wb = Workbook.create();
const headers = ['字段类型','字段英文名','字段中文名','字段数据类型','字段描述'];
function add(name, rows, tableName) {
  const s=wb.worksheets.add(name);
  s.showGridLines=false;
  s.getRange(`A1:E${rows.length+1}`).values=[headers,...rows];
  const r=s.getRange(`A1:E${rows.length+1}`);
  r.format.font={name:'Arial',size:11,color:'#25334A'};
  r.format.verticalAlignment='center';
  r.format.wrapText=true;
  r.format.rowHeight=40;
  const widths=[100,355,220,115,480];
  widths.forEach((w,i)=>s.getRangeByIndexes(0,i,rows.length+1,1).format.columnWidthPx=w);
  s.getRange('A1:E1').format={fill:'#264667',font:{bold:true,color:'#FFFFFF',size:11},rowHeight:32,horizontalAlignment:'center'};
  for(let i=0;i<rows.length;i++) {
    if(i%2===1)s.getRange(`A${i+2}:E${i+2}`).format.fill='#F0F4F8';
    const lines=Math.max(...rows[i].map((v,j)=>Math.ceil([...String(v)].reduce((a,c)=>a+(c.charCodeAt(0)>255?14:7),0)/(widths[j]-20))));
    s.getRange(`A${i+2}:E${i+2}`).format.rowHeight=Math.max(32,lines*15+12);
  }
  s.freezePanes.freezeRows(1);
  const table=s.tables.add(`A1:E${rows.length+1}`,true,tableName);
  table.showFilterButton=true;
  return s;
}
add('指标字段标准',data.metrics,'QianchuanMetrics');
const p=add('接口参数与口径',data.params,'QianchuanParameters');
const notes=[
 ['适用范围','获取今日直播数据；GET /open_api/v1.0/qianchuan/report/live/get/。仅覆盖指定文档，非千川全部报表字段全集。'],
 ['统计数量','正文业务指标39项；请求参数6项；请求头1项；应答结构字段4项。未新增正文没有提供的时间维度或直播场次ID。'],
 ['流量口径','基于全部流量（自然+营销）的抖音号及直播间整体数据；具体指标保留“整体”“营销”等原文名称。'],
 ['查询时间','开播时间在筛选日期内的直播间会被统计；end_time 为 start_time 同一天的23:59:59。文档说明查询一天0点至24点的数据。'],
 ['金额单位','data 说明：金额相关指标单位为“千分之一分”。换算为人民币元需除以100000；此换算不适用于次数、比例、ROI或音浪等其他单位。'],
 ['未明确的口径','正文未给出各比率的分子/分母、返回值是否已乘100，以及GPM的具体计算公式；不补写推测公式。音浪收入不直接视为人民币金额。'],
 ['账户限制','整体ROI、整体下单率、整体成单率仅支持直客客户的官方/自运营抖音号。stats_authority 默认 CURRENT；QUALIFICATION 仅直客账户支持。'],
 ['字段类型','保留正文 float / number / string 等原始标注；整体预售订单数原文为 float，不擅自改为整数。ID落库建议按长整型或字符串保存，避免精度丢失。'],
 ['落库建议','可将 advertiser_id、aweme_id、start_time、end_time、stats_authority 随采集结果保存，作为请求上下文；它们不是此接口返回的报表维度。'],
 ['文档差异','结构化定义额外列出20个无描述字段，另有 ecp_convert_cnt 类型差异；详见“文档差异待核验”。这些额外字段未并入39项指标。'],
 ['核验状态','整理日期：2026-10-21。已核对官方页面正文、官方Markdown与结构化定义；未调用账户数据接口验证字段可用性。'],
 ['页面来源','https://open.oceanengine.com/labels/12/docs/1763406675800128?origin=left_nav'],
 ['正文来源','https://open.oceanengine.com/skiff/api/doc/client/markdown/get/?language=CHINESE&doc_id=1763406675800128'],
 ['结构化定义','https://open.oceanengine.com/skiff/api/doc/client/schema/markdown/get/?doc_id=1763406675800128'],
];
for(let i=0;i<notes.length;i++){
 const row=15+i;
 p.getRange(`A${row}`).values=[[notes[i][0]]];
 p.getRange(`B${row}:E${row}`).merge();
 p.getRange(`B${row}`).values=[[notes[i][1]]];
 p.getRange(`A${row}:E${row}`).format={font:{name:'Arial',size:11,color:'#25334A'},wrapText:true,verticalAlignment:'center',rowHeight:44};
 p.getRange(`A${row}`).format.font.bold=true;
 if(i%2===0)p.getRange(`A${row}:E${row}`).format.fill='#F0F4F8';
}
add('文档差异待核验',data.diffs,'QianchuanDifferences');
wb.recalculate();
console.log((await wb.inspect({kind:'table',range:'指标字段标准!A1:E5',include:'values',tableMaxRows:5,tableMaxCols:5,maxChars:1800})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:20},maxChars:1000})).ndjson);
for(const [sheet,range,file] of [['指标字段标准','A1:E12','metrics'],['接口参数与口径','A1:E12','parameters'],['接口参数与口径','A15:E28','notes'],['文档差异待核验','A1:E10','differences']]){
 const blob=await wb.render({sheetName:sheet,range,scale:1,format:'png'});
 await fs.writeFile(dir+file+'.png',new Uint8Array(await blob.arrayBuffer()));
}
const output=await SpreadsheetFile.exportXlsx(wb);
await output.save(dir+'巨量千川表头字段标准.xlsx');
console.log('Exported 39 metrics, 11 interface fields and 21 discrepancy records.');
