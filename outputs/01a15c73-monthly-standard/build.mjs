import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
const dir=path.dirname(new URL(import.meta.url).pathname);
const root=path.resolve(dir,'../..');
const source=await fs.readFile(path.join(root,'src/pages/LiveDatasetFields.ts'),'utf8');
const scope=source.slice(source.indexOf('export const monthlyDimensions'),source.indexOf('export const monthlyColumns'));
const removed=new Set(['earlyHours','earlySessions','earlySpend','earlyPremium','regularHours','regularSpend','regularPremium']);
const columns=[...scope.matchAll(/\{key:'([^']+)',label:'([^']+)'\}/g)].map(m=>({key:m[1],label:m[2]})).filter(c=>!removed.has(c.key));
const fields=JSON.parse(await fs.readFile(path.join(dir,'fields.json'),'utf8'));
if(columns.length!==28 || Object.keys(fields).length!==columns.length) throw new Error('产品字段数量已变化，请重新核对');
const rows=[['字段中文名','字段英文名','字段数据类型','字段说明 / 枚举'],...columns.map(({key,label})=>{
  if(!fields[key]) throw new Error(`缺少 ${key}`);
  const [name,type,note]=fields[key];
  return [label,name,type,`${note}\n产品字段：${key}。`];
})];
if(new Set(rows.slice(1).map(r=>r[1])).size!==28) throw new Error('字段英文名重复');
if(rows.some(r=>r.some(c=>/早班|early|正常|regular/i.test(c)))) throw new Error('存在已移除字段的引用');
if(rows.some(r=>r.length!==4||r.some(c=>!c.trim()))) throw new Error('字段为空');
const workbook=Workbook.create();
const sheet=workbook.worksheets.add('统一月报表头字段');
const range=sheet.getRange('A1:D29');
range.values=rows;
range.format={font:{name:'Arial',size:10,color:'#000000',bold:false,italic:false},fill:'#FFFFFF',wrapText:true,verticalAlignment:'center',horizontalAlignment:'center',borders:{preset:'all',style:'thin',color:'#1F2329'}};
sheet.getRange('A1:D1').format={fill:'#13284B',font:{name:'Arial',size:12,bold:true,color:'#FFFFFF'},rowHeight:30};
const widths=[210,285,175,850];
widths.forEach((width,i)=>sheet.getRange(`${String.fromCharCode(65+i)}1:${String.fromCharCode(65+i)}29`).format.columnWidthPx=width);
sheet.getRange('D2:D29').format.horizontalAlignment='left';
const textWidth=s=>[...s].reduce((n,c)=>n+(/[\u2e80-\uffff]/.test(c)?13.4:7),0);
rows.slice(1).forEach((row,i)=>{
  const lines=Math.max(...row.map((s,j)=>s.split('\n').reduce((n,p)=>n+Math.max(1,Math.ceil(textWidth(p)/(widths[j]-20))),0)));
  sheet.getRange(`A${i+2}:D${i+2}`).format.rowHeightPx=Math.max(42,lines*19+16);
});
sheet.freezePanes.freezeRows(1);
workbook.recalculate();
for(const [key,range] of [['hours-spend','A15:D22'],['premium-efficiency','A23:D29']]) {
  const image=await workbook.render({sheetName:sheet.name,range,scale:1.3,format:'png'});
  await fs.writeFile(path.join(dir,`${key}.png`),new Uint8Array(await image.arrayBuffer()));
}
console.log((await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:10},summary:'最终错误扫描'})).ndjson);
await fs.writeFile(path.join(dir,'expected.json'),JSON.stringify(rows,null,2));
await fs.writeFile(path.join(dir,'source-columns.json'),JSON.stringify(columns,null,2));
await (await SpreadsheetFile.exportXlsx(workbook)).save(path.join(dir,'统一月报表头字段.xlsx'));
console.log(JSON.stringify({fields:columns.length,dimensions:13,metrics:15,columns:rows[0]}));
