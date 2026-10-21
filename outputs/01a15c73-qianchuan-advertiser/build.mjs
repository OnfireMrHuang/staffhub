import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
const dir=new URL('.',import.meta.url).pathname;
const base='/Users/huangwenwu/meimei/staffhub/docs/直播数据管理设计方案/';
const source=JSON.parse(await fs.readFile(dir+'source-schema.json','utf8'));
const extracted=JSON.parse(await fs.readFile(dir+'extracted.json','utf8'));
const previous=await SpreadsheetFile.importXlsx(await FileBlob.load(base+'巨量千川表头字段标准.xlsx'));
const before=await previous.render({sheetName:previous.worksheets.getItemAt(0).name,range:'A1:E5',scale:1,format:'png'});
await fs.writeFile(dir+'before.png',new Uint8Array(await before.arrayBuffer()));
const req=source.request.data;
const filtering=req.find(x=>x.name==='filtering').children;
const row=(name,cn,type,description)=>['维度',name,cn,type,description];
const dims=[
 row('stat_datetime','数据起始时间','string','时间维度。原生返回 data.list[].stat_datetime；仅传入 time_granularity 时返回，格式 yyyy-MM-dd HH:mm:ss。不传粒度时是查询区间汇总，不伪造此字段。'),
 row('stat_time_day','统计日期','string','时间维度。派生：日/小时粒度下从返回 stat_datetime 提取 YYYY-MM-DD；区间汇总时留空，不能将多日汇总标为某一天。'),
 row('stat_time_hour','统计小时','string','时间维度。派生：仅小时粒度时保留 stat_datetime 对应小时，格式 YYYY-MM-DD HH:00:00；日粒度和区间汇总时留空。'),
 row('start_date','查询开始日期','string','时间维度。来源：必填请求参数 start_date，格式 YYYY-MM-DD；不得早于今日前180天。不是实际开播时间。'),
 row('end_date','查询结束日期','string','时间维度。来源：必填请求参数 end_date。区间汇总跨度≤180天、按天≤30天、按小时≤7天；不是实际下播时间。'),
 row('time_granularity','时间粒度','string','时间维度。请求参数：TIME_GRANULARITY_DAILY 按天；TIME_GRANULARITY_HOURLY 按小时；未传时记录为空并按查询区间汇总，不自造API枚举。'),
 row('advertiser_id','账户ID','number','账户维度。必填请求参数，也是 data.list[].advertiser_id 原生返回字段；建议用字符串保存长ID，避免精度丢失。'),
 row('account_name','账户名称','string','账户维度。按 advertiser_id 从账户主数据/试点账户清单关联；不是本报表原生返回字段。保留查询时对应名称。'),
 row('account_type','账户类型','string','账户维度。来源：试点账户清单/账户配置，例如直投、短视频投放；按生效时间关联，不按账户名称推断。'),
 row('stat_platform','统计平台','string','账户维度。来源：账户配置/采集上下文，本表取值为巨量千川；与 filtering.order_platform（下单平台）是不同概念。'),
 ...filtering.map(f=>row(f.name,({marketing_goal:'营销目标',order_platform:'下单平台',marketing_scene:'营销类型',smart_bid_type:'投放方式',status:'计划状态筛选',aweme_ids:'筛选抖音号ID集合',campaign_scene:'营销场景'})[f.name],f.type==='array'?'number[]':f.type,
 `筛选维度。来源：filtering.${f.name}，随结果保存，不是返回的分组维度。${f.description.replace(/\n/g,' ')}${f.name==='marketing_goal'?' 文档明确：账户报表不再返回此字段；只能从请求回填。':f.name==='aweme_ids'?' 多个ID代表筛选集合，返回结果不按抖音号拆分。':''}`)),
 row('aweme_id','单一归属抖音号ID','number','直播间关联维度。仅当 filtering.aweme_ids 恰好一个有效ID时从该集合回填；未筛选或多ID时留空。不是返回字段，也不是直播场次 room_id。'),
 row('aweme_show_id','手机端可见抖音号','string','直播间关联维度。仅在单一抖音号可核验归属时由授权抖音号资料/主数据关联；不把手机端号码直接等同接口ID。不能确定时留空。'),
 row('aweme_nick_name','抖音昵称','string','直播间关联维度。单一抖音号归属明确时从已核验主数据关联；此名称是内部标准，不是本接口原生返回字段。昵称不作为唯一标识。'),
 row('room_name','业务直播间名称','string','直播间关联维度。按账户、单一抖音号及生效时间关联业务配置；不等于场次ID。无筛选/多抖音号或归属不唯一时留空，不能把账户汇总复制给多个直播间。'),
];
const labels={advertiser_id:'账户ID',start_date:'查询开始日期',end_date:'查询结束日期',fields:'查询指标列表',filtering:'过滤条件',time_granularity:'时间粒度',order_field:'排序字段',order_type:'排序方式',page:'页码',page_size:'页面大小'};
const params=[['请求头','Access-Token','授权令牌','string','必填。授权 access_token；不保存到业务表头或业务数据。']];
for(const f of req){
 params.push(['请求参数',f.name,labels[f.name],f.type==='array'?'string[]':f.type,`${f.required?'必填':'选填'}。${f.description}`]);
 if(f.name==='filtering')for(const sub of filtering)params.push(['过滤参数','filtering.'+sub.name,dims.find(x=>x[1]===sub.name)[2],sub.type==='array'?'number[]':sub.type,`${sub.required?'必填':'选填'}。${sub.description}`]);
}
const envelopeNames={code:'返回码',message:'返回信息',data:'返回数据',list:'数据列表',page_info:'分页信息',page:'页码',page_size:'页面大小',total_number:'总数',total_page:'总页数',request_id:'请求日志ID'};
for(const [n,t,d] of extracted.response){
 if(!(n in envelopeNames))continue;
 const path=n==='list'?'data.list':n==='page_info'?'data.page_info':['page','page_size','total_number','total_page'].includes(n)?'data.page_info.'+n:n;
 params.push(['应答结构',path,envelopeNames[n],t,d]);
}
const notes=[
 ['适用接口','获取投放账户数据','GET https://ad.oceanengine.com/open_api/v1.0/qianchuan/report/advertiser/get/'],
 ['字段总数',`${dims.length+96}项`,`${dims.length}项维度（原生返回、请求上下文、派生及关联字段）＋96项指标；主表保留五列表头。`],
 ['原生维度','advertiser_id、stat_datetime','返回 data.list[] 按账户与所选时间粒度统计；stat_datetime 仅在传入 time_granularity 时返回。'],
 ['时间范围','日≤30天；小时≤7天；区间≤180天','start_date 不得早于今日前180天。未传时间粒度时为整个查询区间汇总。禁止把区间数据重复填到每一天。'],
 ['账户与直播间','筛选不等于按抖音号分组','aweme_ids 是过滤集合，不是返回维度。一次筛选多个ID时，不能把该行拆成多条直播间数据；单一筛选才可条件回填 aweme_id 并关联昵称等。'],
 ['营销目标','marketing_goal 不再返回','仍是 filtering 的必填子参数，可选 ALL、VIDEO_PROM_GOODS、LIVE_PROM_GOODS。标准表保存请求值，不假定响应含此字段。'],
 ['统计平台','stat_platform = 巨量千川','order_platform 是下单平台（ALL、QIANCHUAN、ECP_AWEME），不得改名为统计平台或与 stat_platform 混用。'],
 ['筛选限制','按文档保留','小店随心推不支持 marketing_scene、smart_bid_type、status、campaign_scene；搜索不支持 smart_bid_type。具体取值见参数页。'],
 ['金额与比例','新文档未明确单位/返回缩放','不沿用旧接口“千分之一分”及除以100000规则。不擅自将点击率等按百分比缩放；金额单位、比率值域及公式待官方确认或接口样本验证。'],
 ['数据类型','保留正文类型','96项指标中94项 float、2项 number。即使名称是次数/订单数也不擅改整数类型。'],
 ['即将下线','convert_cnt、convert_cost、convert_rate','正文仍列出，已保留并标注“即将下线”。同时保留 ecp_* 与 attribution_* 指标；不自行认定它们等价或直接替换。'],
 ['归因口径','直接、间接、7/14日、计费时间','保留原文业务口径，不把同名近似指标合并或把直接成交与7日总成交等重复累加。新文档未声明自然＋营销全流量，不沿用旧接口口径。'],
 ['新旧调整','已替换错误来源','删除旧接口专属 start_time、end_time、stats_authority 及旧指标清单；改用新文档的查询日期、时间粒度、筛选条件与96项指标。'],
 ['来源核验','正文与结构化定义一致','96项指标的字段名、顺序、类型及描述（忽略空白）已逐项核对一致；旧文档的20项额外字段与类型差异记录不再适用。未进行账户数据实测。'],
 ['关联来源','试点账户清单/账户主数据','账户名称、账户类型、业务直播间名称按配置与生效时间关联。缺失或歧义留空，不推测归属。'],
 ['整理日期','2026-10-21','按本次提供的正确文档修订。'],
 ['官方页面','获取投放账户数据','https://open.oceanengine.com/labels/12/docs/1697466393573376'],
 ['官方正文','Markdown','https://open.oceanengine.com/skiff/api/doc/client/markdown/get/?language=CHINESE&doc_id=1697466393573376'],
 ['官方结构','Schema','https://open.oceanengine.com/skiff/api/doc/client/schema/markdown/get/?doc_id=1697466393573376'],
];
if(dims.length!==21)throw new Error('dimension count');
const wb=Workbook.create();
function sheet(name,headers,rows,widths,tableName){
 const s=wb.worksheets.add(name);s.showGridLines=false;
 const end=headers.length===5?'E':'C';const all=s.getRange(`A1:${end}${rows.length+1}`);
 all.values=[headers,...rows];all.format.font={name:'Arial',size:11,color:'#25334A'};all.format.wrapText=true;all.format.verticalAlignment='center';
 widths.forEach((width,i)=>s.getRangeByIndexes(0,i,rows.length+1,1).format.columnWidthPx=width);
 s.tables.add(`A1:${end}${rows.length+1}`,true,tableName).style='TableStyleMedium2';
 s.getRange(`A1:${end}1`).format={fill:'#264667',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},rowHeight:32,horizontalAlignment:'center'};
 for(let i=0;i<rows.length;i++){
  const lines=Math.max(...rows[i].map((v,j)=>String(v).split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((a,c)=>a+(c.charCodeAt(0)>255?15:8),0)/(widths[j]-25))),0)));
  s.getRange(`A${i+2}:${end}${i+2}`).format.rowHeight=Math.max(32,lines*15+14);
 }
 s.freezePanes.freezeRows(1);return s;
}
const headers=['字段类型','字段英文名','字段中文名','字段数据类型','字段描述'];
sheet('表头字段标准',headers,[...dims,...extracted.metrics],[95,350,250,115,520],'QianchuanFields');
sheet('接口参数与口径',headers,params,[95,350,250,115,520],'QianchuanParameters');
sheet('口径与修订说明',['项目','内容','说明/来源'],notes,[125,340,865],'QianchuanNotes');
wb.recalculate();
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?',options:{useRegex:true,maxResults:10},maxChars:800})).ndjson);
for(const [s,r,f] of [['表头字段标准','A1:E12','dimensions'],['表头字段标准','A13:E24','dimensions2'],['表头字段标准','A23:E33','metrics'],['接口参数与口径','A1:E9','params'],['口径与修订说明','A1:C20','notes']]){
 const b=await wb.render({sheetName:s,range:r,scale:1,format:'png'});await fs.writeFile(dir+f+'.png',new Uint8Array(await b.arrayBuffer()));
}
const out=await SpreadsheetFile.exportXlsx(wb);await out.save(dir+'巨量千川表头字段标准.xlsx');
await fs.writeFile(dir+'expected.json',JSON.stringify({dims,metrics:extracted.metrics,params,notes},null,2));
console.log({dimensions:dims.length,metrics:96,parameters:params.length,total:dims.length+96});
