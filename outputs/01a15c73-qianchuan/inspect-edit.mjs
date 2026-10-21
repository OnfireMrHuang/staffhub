import fs from 'node:fs/promises';
import {Workbook,FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const base='/Users/huangwenwu/meimei/staffhub/docs/直播数据管理设计方案/';
for(const [key,name] of [['qc','巨量千川表头字段标准.xlsx'],['smart','巨量营销-智擎版表头字段标准.xlsx']]){
 const w=await SpreadsheetFile.importXlsx(await FileBlob.load(base+name));
 console.log(key,(await w.inspect({kind:'sheet',include:'id,name',maxChars:1000})).ndjson);
 const b=await w.render({sheetName:key==='qc'?'指标字段标准':'Sheet1',range:'A1:E7',scale:1,format:'png'});
 await fs.writeFile(new URL(`before-${key}.png`,import.meta.url),new Uint8Array(await b.arrayBuffer()));
}
const w=Workbook.create();w.worksheets.add('Temp');
console.log(w.help('range.insert',{include:'index,examples,notes',maxChars:3500}).ndjson);
console.log(w.help('table.resize',{include:'index,examples,notes',maxChars:1500}).ndjson);
