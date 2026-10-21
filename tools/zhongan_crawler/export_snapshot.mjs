// Run from a directory whose node_modules contains @oai/artifact-tool.
// Usage: node export_snapshot.mjs /absolute/raw/run/batches.json /absolute/output [--fields-only]
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require = createRequire(path.join(process.cwd(), '__artifact_resolver.cjs'));
const {Workbook, SpreadsheetFile} = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
const [input, output] = process.argv.slice(2);
const fieldsOnly = process.argv.includes('--fields-only');
if (!input || !output) throw new Error('需要 batches.json 路径及输出目录');
const snapshot = JSON.parse(await fs.readFile(input, 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(input), 'manifest.json'), 'utf8'));
if (!manifest.complete || !snapshot.batches?.length) throw new Error('拒绝导出不完整采集');
await fs.mkdir(output, {recursive:true});

const labels = {
  orderNo:'订单号', productName:'产品名称', orderAmount:'订单金额', orderStatus:'订单状态码',
  bizDate:'订单日期', bizTime:'订单时间', 'holderInfo.name':'投保人姓名',
  'holderInfo.age':'投保人年龄区间', 'holderInfo.hasSi':'投保人社保标记',
  'holderInfo.relation':'投保人关系标记', 'holderInfo.uwStatus':'投保人核保状态码',
  insuredInfoList:'被保人信息（JSON）', payMethod:'缴费方式', paymentMethod:'支付方式码',
  orderCnt:'订单数', paidCnt:'支付次数', upgradeFlag:'升级标记', accountId:'账户ID',
  nextPage:'分页游标', orderDetailList:'关联订单明细（JSON）', moreDetailFlag:'更多明细标记',
  media:'媒体标记', payBlockInfo:'支付阻断信息', hasSendReachSms:'触达短信发送标记',
  cost:'消耗', policyCnt:'保单数', policyRate:'保单率', annualPremiumRate:'年缴比',
  distinctOrder:'去重订单数', multipleRate:'投/被多单比', otp:'OTP',
  totalPremium:'总保费', totalAmount:'总金额', liveLandingUV:'落地页UV', roi:'ROI',
  policyCost:'保单成本', premiumAvg:'平均保费', emptyCostRate:'空耗率',
  roomCreateTime:'场次创建时间', roomFinishTime:'场次结束时间',
  mayAmount:'mayAmount', adLiveEstimatedRoi:'预估ROI', adInfoList:'广告信息（JSON）',
  mainRoi:'主险ROI', notMainRoi:'非主险ROI', lumpSumPaymentRate:'lumpSumPaymentRate',
  lumpSumPaidRate:'lumpSumPaidRate', wlPaidRate:'wlPaidRate', packageRate:'套餐率',
  adLiveFunnelPlot:'漏斗数据（JSON）', showCnt:'曝光次数', liveWatchCount:'直播观看次数',
  liveCardIconComponentClickCount:'直播组件点击次数', upgradeRate:'升级率',
  cancelZeroCnt:'零元退保数', cancelZeroRate:'零元退保率', firstYearRecyclingMain:'firstYearRecyclingMain',
  uvValue:'UV价值', averageOrderValue:'平均订单金额', averageInsuranceNum:'平均投保件数',
  sixtyPolicyPercentage:'sixtyPolicyPercentage', timeSharingConsumption:'分时消耗',
  inboundCnt:'inboundCnt', inboundSpeakRate:'inboundSpeakRate',
};
const confirmed = new Set(['cost','policyCnt','policyRate','annualPremiumRate','orderCnt','distinctOrder','multipleRate','otp',
  'orderNo','productName','orderAmount','orderStatus','bizDate','bizTime','holderInfo.name','holderInfo.age','payMethod','insuredInfoList','orderDetailList']);
const metaSpecs = [
  ['livePlatform','直播平台'], ['dyNo','直播间号码'], ['anchorNick','直播间名称'],
  ['agentLiveName','所属机构'], ['startDate','统计日期'], ['roomId','直播场次ID'],
  ['startTime','开播时间'], ['collectedAt','采集时间（北京时间）'],
];
const flatten = (o, prefix='') => Object.fromEntries(Object.entries(o).flatMap(([k,v]) => {
  const name = prefix ? `${prefix}.${k}` : k;
  return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length
    ? Object.entries(flatten(v,name)) : [[name,v]];
}));
const letter = n => { let s=''; for(n++; n; n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s; return s; };
const source = `https://adagent.zhongan.com/app-live/liveStream/dashboard/?livePlatform=${encodeURIComponent(manifest.platform)}&dyNo=${encodeURIComponent(manifest.dyNo)}&startDate=${encodeURIComponent(manifest.date)}`;
const meta = room => Object.fromEntries(metaSpecs.map(([key])=>[key,key==='collectedAt'?snapshot.collectedAt:room[key]??null]));
const stats = snapshot.batches.map(([room,agg])=>({meta:meta(room),data:flatten(agg)}));
const orders = snapshot.batches.flatMap(([room,,rows])=>rows.map(row=>({meta:meta(room),data:flatten(row)})));
if (orders.length !== manifest.orders) throw new Error('订单数量与采集清单不符');
const seen = new Set();
for(const row of orders) {
  const id = `${row.meta.roomId}:${row.data.orderNo}`;
  if (!row.data.orderNo || seen.has(id)) throw new Error('订单号缺失或重复');
  seen.add(id);
}

function specsFor(rows, isOrders) {
  const keys = [...new Set(rows.flatMap(row=>Object.keys(row.data)))];
  const priority = isOrders ? ['orderNo','productName','bizDate','bizTime','orderAmount','orderStatus','holderInfo.name','holderInfo.age','payMethod']
    : ['cost','policyCnt','orderCnt','distinctOrder','policyRate','annualPremiumRate','multipleRate','totalPremium'];
  const ordered = [...priority.filter(k=>keys.includes(k)),...keys.filter(k=>!priority.includes(k))];
  // A successful empty result still has useful context and the stable API identity field.
  if (isOrders && !ordered.length) ordered.push('orderNo');
  return [...metaSpecs.map(([key,label])=>({key,label,group:'meta'})),
    ...ordered.map(key=>({key,label:`${labels[key]??key} [${key}]`,group:'data'}))];
}
function typeOf(v) {return v===null||v===undefined?'空值':Array.isArray(v)?'数组':typeof v==='object'?'对象':typeof v==='number'?'数值':typeof v==='boolean'?'布尔':'文本';}
function formatFor(s) {
  if (['orderNo','roomId','dyNo','accountId','nextPage'].includes(s.key)) return '@';
  if (['startDate','bizDate'].includes(s.key)) return 'yyyy-mm-dd';
  if (['startTime','collectedAt','roomCreateTime','roomFinishTime'].includes(s.key)) return 'yyyy-mm-dd hh:mm:ss';
  if (s.group==='data' && /Rate$/.test(s.key)) return '0.00%';
  if (s.group==='data' && /^(cost|totalPremium|totalAmount|orderAmount|policyCost|premiumAvg|averageOrderValue|uvValue)$/.test(s.key)) return '#,##0.00';
  return undefined;
}
function valueFor(row, s) {
  let v = row[s.group][s.key] ?? null;
  if(v===null) return null;
  if(typeof v==='number' && !Number.isSafeInteger(v) && Number.isInteger(v)) throw new Error(`不安全整数：${s.key}`);
  const format=formatFor(s);
  if (format?.startsWith('yyyy') && typeof v==='string') {
    // Excel serials encode the displayed China wall clock, without applying a second timezone shift.
    const t=v.slice(0,19).replace('T',' ');
    if(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(t)) return new Date(t.replace(' ','T')+(t.length===10?'T00:00:00Z':'Z'));
  }
  if(typeof v==='object') v=JSON.stringify(v);
  if (['orderNo','roomId','dyNo','accountId','nextPage'].includes(s.key) && v!==null) v=String(v);
  if(typeof v==='string') {
    if(v.length>32767) throw new Error(`字段超出Excel上限：${s.key}`);
    if(v.startsWith('=')) v="'"+v;
  }
  return v;
}
function noteFor(s,isOrders) {
  if(s.group==='meta') return s.key==='collectedAt'?'本轮分页全部完成时间，UTC+08:00':s.key==='startDate'?'按开播日期选择场次；统计为该场次整场快照':'采集上下文；标识符按文本保存';
  if(s.key==='nextPage') return '技术分页游标；仅各页末条可能有值，不是业务指标';
  if(s.key==='roomFinishTime') return '本次2099-01-01为接口占位值；页面显示正在进行，非实际结束时间';
  if(s.key==='orderStatus') return '保留原始状态码；本次包含1、2、10，不推断全部状态枚举';
  if(s.key==='orderCnt'&&isOrders) return '订单卡片购险记录中的下单次数；不能求和作为本场订单总数';
  if(s.key==='paidCnt') return '订单卡片购险记录中的支付次数；不能求和作为本场保单总数';
  if(s.key==='insuredInfoList') return '完整JSON数组；元素含name、age、hasSi、relation、uwStatus，保留页面脱敏信息';
  if(s.key==='orderDetailList') return '完整关联订单JSON数组；不展开成多行，避免主订单重复计数';
  if(s.key==='policyRate') return '接口原值；本次140/240=58.33%，分母为去重订单数';
  if(!confirmed.has(s.key)) return '保留接口原值；中文按字段名释义，精确业务口径待确认';
  return '保留接口原值；空值为空白，未以0代替；金额不作元/分换算';
}
function dictionary(rows,specs,isOrders) {
  return specs.map(s=>{
    const values=rows.map(row=>row[s.group][s.key]);
    const types=[...new Set(values.filter(v=>v!==null&&v!==undefined).map(typeOf))];
    const sourceName=s.group==='meta'?(s.key==='collectedAt'?'采集程序':'场次上下文'):isOrders?'getOrderList':'getDashboardAggregate';
    return [s.group==='meta'?s.label:(labels[s.key]??s.key),s.key,s.group==='meta'?`context.${s.key}`:`data${isOrders?'[]':''}.${s.key}`,sourceName,
      types.join(' / ')||'本次全空，类型待确认',formatFor(s)||'原值（标识符为文本）',
      values.filter(v=>v!==null&&v!==undefined&&v!=='').length,rows.length,noteFor(s,isOrders)];
  });
}
async function build(name, sheetName, headers, values, formats, isDictionary=false) {
  const wb=Workbook.create(); const sh=wb.worksheets.add(sheetName); sh.showGridLines=false;
  const headerRow=isDictionary?1:5, firstData=headerRow+1;
  const last=letter(headers.length-1), end=values.length+headerRow;
  if(!isDictionary) {
  sh.getRange('A1').values=[[sheetName]];
  sh.getRange('A1').format.font={name:'Arial',size:16,bold:true,color:'#18364A'};
  sh.getRange('A1').format.rowHeight=28;
  sh.getRange('A2').values=[[`来源：${source}`]];
  sh.getRange('A3').values=[[`开播日期 ${manifest.date}；直播间 ${manifest.dyNo}；采集完成 ${snapshot.collectedAt}；${isDictionary?'一行对应数据表的一列表头':'场次整场数据快照，非全天汇总'}`]];
  sh.getRange(`A2:${last}3`).format.font={name:'Arial',size:10,color:'#536471'};
  }
  sh.getRange(`A${headerRow}:${last}${end}`).values=[headers,...values];
  const area=sh.getRange(`A${headerRow}:${last}${end}`);
  area.format.font={name:'Arial',size:10,color:'#243746'};
  area.format.rowHeight=24; area.format.columnWidth=24; area.format.verticalAlignment='center';
  sh.getRange(`A${headerRow}:${last}${headerRow}`).format={fill:'#224B70',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},wrapText:true,rowHeight:48,horizontalAlignment:'center'};
  if(values.length) {
    const table=sh.tables.add(`A${headerRow}:${last}${end}`,true,isDictionary?'FieldsTable':'DataTable');
    table.showFilterButton=true;
    for(let i=0;i<headers.length;i++) {
      if(formats[i]) sh.getRange(`${letter(i)}${firstData}:${letter(i)}${end}`).setNumberFormat(formats[i]);
      const width=isDictionary?[48,36,48,28,28,28,14,14,88][i]:(headers[i].includes('JSON')?70:headers[i].includes('直播间名称')?70:headers[i].includes('所属机构')?40:/ID|订单号/.test(headers[i])?32:headers[i].includes('时间')?30:Math.min(44,Math.max(22,headers[i].length*1.1)));
      sh.getRange(`${letter(i)}${headerRow}:${letter(i)}${end}`).format.columnWidth=width;
      if(headers[i].includes('JSON')) sh.getRange(`${letter(i)}${firstData}:${letter(i)}${end}`).format.wrapText=true;
    }
    if(isDictionary) {
      sh.getRange(`A${firstData}:${last}${end}`).format.wrapText=true;
      sh.getRange(`A${firstData}:${last}${end}`).format.rowHeight=44;
    } else {
      sh.getRange(`A6:${last}${end}`).format.autofitRows();
    }
  }
  sh.freezePanes.freezeRows(headerRow);
  wb.recalculate();
  const inspection=await wb.inspect({kind:'table',range:`${sheetName}!A${headerRow}:${letter(Math.min(headers.length-1,4))}${Math.min(end,headerRow+2)}`,include:'values',tableMaxRows:3,tableMaxCols:5});
  await fs.writeFile(path.join(output,`${name}.inspect.json`),inspection.ndjson,{mode:0o600});
  const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:20}});
  await fs.writeFile(path.join(output,`${name}.checks.json`),errors.ndjson,{mode:0o600});
  const preview=await wb.render({sheetName,range:`A1:${isDictionary?'E':'H'}${Math.min(end,10)}`,scale:1,format:'png'});
  await fs.writeFile(path.join(output,`${name}.png`),new Uint8Array(await preview.arrayBuffer()),{mode:0o600});
  const detail=await wb.render({sheetName,range:isDictionary?`F1:I${Math.min(end,8)}`:`I5:P${Math.min(end,10)}`,scale:1,format:'png'});
  await fs.writeFile(path.join(output,`${name}.detail.png`),new Uint8Array(await detail.arrayBuffer()),{mode:0o600});
  const file=await SpreadsheetFile.exportXlsx(wb);
  const target=path.join(output,`${name}.xlsx`); await file.save(target); await fs.chmod(target,0o600);
  return {file:target,rows:values.length,columns:headers.length};
}

const results=[];
const dictionaryHeaders=['字段中文名','字段英文名','原始字段路径','来源接口','本次数据类型','Excel显示格式','非空记录数','总记录数','字段说明与口径'];
for(const [name,rows,isOrders] of [['订单信息',orders,true],['直播间统计',stats,false]]) {
  const specs=specsFor(rows,isOrders);
  if(!fieldsOnly) results.push(await build(name,name,specs.map(s=>s.label),rows.map(row=>specs.map(s=>valueFor(row,s))),specs.map(formatFor)));
  results.push(await build(`${name}表头字段`,`${name}表头字段`,dictionaryHeaders,dictionary(rows,specs,isOrders),[],true));
}
const manifestPath=path.join(output,'export_manifest.json');
const previous=fieldsOnly?JSON.parse(await fs.readFile(manifestPath,'utf8')):null;
const allResults=previous?[...previous.results.filter(old=>!results.some(row=>row.file===old.file)),...results]:results;
await fs.writeFile(manifestPath,JSON.stringify({source,collectedAt:snapshot.collectedAt,results:allResults},null,2),{mode:0o600});
console.log(JSON.stringify(results,null,2));
