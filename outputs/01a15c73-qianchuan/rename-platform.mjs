import fs from 'node:fs/promises';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const dir=new URL('.',import.meta.url).pathname;
const base='/Users/huangwenwu/meimei/staffhub/docs/直播数据管理设计方案/';
for(const [key,name] of [['qc','巨量千川表头字段标准.xlsx'],['smart','巨量营销-智擎版表头字段标准.xlsx']]){
 const w=await SpreadsheetFile.importXlsx(await FileBlob.load(base+name));
 const s=w.worksheets.getItemAt(0);
 const rows=s.getUsedRange().values;
 const indices=rows.map((r,i)=>r[1]==='version'?i+1:0).filter(Boolean);
 if(indices.length!==1)throw new Error(name+': expected exactly one version field');
 const row=indices[0];
 const before=await w.render({sheetName:s.name,range:`A${row}:E${row}`,scale:1,format:'png'});
 await fs.writeFile(dir+`platform-before-${key}.png`,new Uint8Array(await before.arrayBuffer()));
 s.getRange(`B${row}:C${row}`).values=[['stat_platform','统计平台']];
 s.getRange(`E${row}`).values=[['账户维度。来源：账户配置/采集上下文。统计平台取值如巨量营销-智擎版、巨量营销-旧版、巨量千川；不是接口返回指标。']];
 if(key==='qc'){
  const p=w.worksheets.getItem('接口参数与口径');
  p.getRange('B23').values=[[p.getRange('B23').values[0][0].replace('账户名称/类型/版本','账户名称/类型/统计平台')]];
 }
 w.recalculate();
 const after=await w.render({sheetName:s.name,range:`A${row}:E${row}`,scale:1,format:'png'});
 await fs.writeFile(dir+`platform-after-${key}.png`,new Uint8Array(await after.arrayBuffer()));
 const out=await SpreadsheetFile.exportXlsx(w);await out.save(dir+name);
 console.log(name,`B${row}:C${row}`,s.getRange(`B${row}:C${row}`).values);
}
