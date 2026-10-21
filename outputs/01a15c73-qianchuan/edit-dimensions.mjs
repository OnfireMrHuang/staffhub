import fs from 'node:fs/promises';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const base='/Users/huangwenwu/meimei/staffhub/docs/直播数据管理设计方案/';
const dir=new URL('.',import.meta.url).pathname;
const account=[
 ['维度','advertiser_id','账户ID','number','账户维度。来源：请求参数 advertiser_id，随结果保存；不是返回指标。建议以字符串保存长ID，避免精度丢失。'],
 ['维度','account_name','账户名称','string','账户维度。来源：账户主数据，按 advertiser_id 关联。统一字段名沿用试点账户清单 account_name；不是本报表接口返回字段。'],
 ['维度','account_type','账户类型','string','账户维度。来源：试点账户清单/账户配置，如直投、短视频投放。为业务分类，按账户及生效时间关联，不按名称推断。'],
 ['维度','stat_platform','统计平台','string','账户维度。来源：账户配置/采集上下文。保留巨量营销-智擎版、巨量营销-旧版、巨量千川等业务值；不是返回指标。'],
];
const qc=[
 ['维度','stat_time_day','统计日期','string','时间维度。派生字段：从请求 start_time 取 YYYY-MM-DD，表示本次查询的开播日期；不是接口返回的时间分组字段，不代表小时数据或单场数据。'],
 ['维度','start_time','查询开始时间','string','时间维度。来源：必填请求参数，格式 YYYY-MM-DD HH:mm:ss。以开播时间筛选直播间；按文档一天口径取当日00:00:00，不作为实际开播时间。'],
 ['维度','end_time','查询结束时间','string','时间维度。来源：必填请求参数，格式 YYYY-MM-DD HH:mm:ss，为 start_time 同一天23:59:59；不作为实际下播时间。'],
 ...account,
 ['维度','stats_authority','投放账户查询范围','string','账户维度。来源：请求参数；未传时记录 CURRENT（当前账户）。QUALIFICATION 为同主体账户，仅直客支持。不得将同主体汇总当作单账户数据叠加。'],
 ['维度','aweme_id','抖音号内部ID','number','直播间维度。来源：必填请求参数 aweme_id，随结果保存。千川内部ID与手机端可见抖音号区分，按授权抖音号列表映射；不是直播场次 room_id。长ID建议字符串保存。'],
 ['维度','aweme_show_id','手机端可见抖音号','string','直播间维度。来源：授权抖音号列表/已核验的主播映射。项目现有工具按 aweme_show_id 匹配内部 aweme_id；不是本报表接口返回字段。'],
 ['维度','aweme_nick_name','抖音昵称','string','直播间维度。关联补充字段：从已核验的抖音号主数据映射昵称，本表统一命名 aweme_nick_name；不是本接口原生字段。昵称可变，不作为唯一标识。'],
 ['维度','room_name','业务直播间名称','string','直播间维度。来源：试点账户清单 room_name，按账户、抖音号及生效时间关联。不可用名称替代抖音号ID或直播场次ID；无法唯一归属时留空，不复制总量到多直播间。'],
];
await fs.mkdir(dir+'dimensions-backup',{recursive:true});
for(const [key,name,dims,first,last] of [
 ['qc','巨量千川表头字段标准.xlsx',qc,2,40],
 ['smart','巨量营销-智擎版表头字段标准.xlsx',account,5,39],
]){
 await fs.copyFile(base+name,dir+'dimensions-backup/'+name);
 const w=await SpreadsheetFile.importXlsx(await FileBlob.load(base+name));
 const s=w.worksheets.getItemAt(0);
 if(key==='qc')s.tables.items[0].delete();
 for(let r=last;r>=first;r--){
  const from=s.getRange(`A${r}:E${r}`), to=s.getRange(`A${r+dims.length}:E${r+dims.length}`);
  const height=from.format.rowHeight;
  to.copyFrom(from,'all');
  if(height)to.format.rowHeight=height;
 }
 for(let i=0;i<dims.length;i++){
  const r=first+i, target=s.getRange(`A${r}:E${r}`);
  target.copyFrom(s.getRange(`A${first+dims.length}:E${first+dims.length}`),'all');
  target.values=[dims[i]];
  target.format.wrapText=true;
  target.format.verticalAlignment='center';
  target.format.rowHeight=key==='qc'?78:120;
 }
 if(key==='qc'){
  const table=s.tables.add(`A1:E${last+dims.length}`,true,'QianchuanMetrics');
  table.style='TableStyleMedium2';table.showFilterButton=true;
  const p=w.worksheets.getItem('接口参数与口径');
  const edits={
   B16:'标准表头共51项：12项维度、39项业务指标。另列6项请求参数、1项请求头、4项应答结构字段；与维度重合的请求参数不重复计算。',
   B23:'维度已纳入首页。时间与ID来自请求参数，日期由start_time派生，账户名称/类型/统计平台及直播间资料由主数据关联；均在描述中标明来源。此接口不提供小时明细或直播场次ID。',
  };
  for(const [cell,value] of Object.entries(edits))p.getRange(cell).values=[[value]];
  const b=await w.render({sheetName:'接口参数与口径',range:'A15:E24',scale:1,format:'png'});
  await fs.writeFile(dir+'after-qc-notes.png',new Uint8Array(await b.arrayBuffer()));
 }
 w.recalculate();
 console.log(key,(await w.inspect({kind:'table',range:`'${s.name}'!A${first}:E${first+1}`,tableMaxRows:2,tableMaxCols:5,maxChars:1400})).ndjson);
 const b=await w.render({sheetName:s.name,range:`A1:E${key==='qc'?14:9}`,scale:1,format:'png'});
 await fs.writeFile(dir+`after-${key}.png`,new Uint8Array(await b.arrayBuffer()));
 const output=await SpreadsheetFile.exportXlsx(w);
 await output.save(dir+name);
 console.log('Saved',name,'added',dims.length,'dimensions');
}
await fs.writeFile(dir+'added-dimensions.json',JSON.stringify({qc,smart:account},null,2));
