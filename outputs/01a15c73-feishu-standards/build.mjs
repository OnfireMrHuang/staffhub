import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool';
const dir = new URL('.', import.meta.url).pathname;
const input = `${dir}飞书原始下载.xlsx`;
if (process.argv.includes('--inspect')) {
  const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
  for (const [sheetName,range,key] of [['统一时报表头字段','A1:E8','hour-before'],['统一日报表头字段','A1:D15','day-before']]) {
    const blob = await wb.render({sheetName,range,scale:1.5,format:'png'});
    await fs.writeFile(`${dir}${key}.png`,new Uint8Array(await blob.arrayBuffer()));
  }
} else {
  const original = JSON.parse(await fs.readFile(`${dir}source-values.json`,'utf8'));
  const definitions = JSON.parse(await fs.readFile(`${dir}completions.json`,'utf8'));
  const baseNotes = {
    product_id:'以文本保存 ID，避免长数字精度丢失。新增 SQL 类型为建议的标准层存储类型，不代表源 API 返回类型。',
    product_name:'名称仅作显示快照，关联与汇总使用 product_id。',
    room_id:'业务直播间主键，不等同抖音账号 aweme_id 或单场直播 ID。',
    room_name:'名称仅作显示快照，关联与汇总使用 room_id。',
    live_date:'时区 Asia/Shanghai。跨零点直播拆分为两条业务日期记录。',
    start_time:'沿用原表整点规则。小时内换主播或停播时，需另行确认如何记录不足一小时区间。',
    end_time:'结束时间为区间右边界，相邻小时不重复计数。24:00 对应次日 00:00。',
    host_id:'使用员工主键，不使用抖音号或广告账户 ID。姓名匹配无结果或多结果时待人工确认。',
    host_name:'匹配后的 host_id 是统计关联键，保留当时姓名用于历史展示。',
    buyer_id:'使用员工主键。姓名匹配无结果或多结果时待人工确认。',
    buyer_name:'匹配后的 buyer_id 是统计关联键，保留当时姓名用于历史展示。',
    control_id:'使用员工主键。姓名匹配无结果或多结果时待人工确认。',
    control_name:'匹配后的 control_id 是统计关联键，保留当时姓名用于历史展示。'
  };
  const expected = {};
  const changes = [];
  let namedTypeCells = 0;
  for (const [name,source] of Object.entries(original)) {
    const hourly = name.includes('时报');
    const rows = structuredClone(source);
    for (let i=1;i<rows.length;i++) {
      const row=rows[i], def=definitions[row[0]];
      for (const j of [1,2]) if (!row[j]?.trim()) {
        if (!def?.[j-1]) throw new Error(`Missing metadata ${name} ${i+1}`);
        row[j]=def[j-1]; namedTypeCells++;
      }
      if (hourly) {
        if (!row[3]?.trim()) row[3]=def?.[2];
        const note=def?.[3] || baseNotes[row[1]];
        if (!note) throw new Error(`Missing note ${name} ${row[0]}`);
        row[4]=row[4]?.trim() ? `${row[4]}\n补充：${note}` : note;
      } else {
        const dayRule = ['时长','时段','月缴保费','年缴保费'].includes(row[0]) ? '' : ' 日报按同一业务日期、直播间归集；只有互斥小时增量可求和，累计快照需取对应日值或已核实的差分。';
        row[3]=`${row[3]}。${def[3]}${dayRule}`;
      }
      for(let j=0;j<row.length;j++) if(row[j]!==source[i][j]) changes.push({sheet:name,cell:`${String.fromCharCode(65+j)}${i+1}`,before:source[i][j],after:row[j]});
    }
    if(new Set(rows.slice(1).map(r=>r[1])).size!==rows.length-1) throw new Error(`Duplicate keys ${name}`);
    if(rows.some(r=>r.some(v=>typeof v!=='string'||!v.trim()))) throw new Error(`Blank ${name}`);
    expected[name]=rows;
    // Export only the two requested worksheets. Preserve their grid, headings,
    // row order, source wording, header colour and original freeze behaviour.
    // The Feishu XLSX import renders transparent cells black; use source values
    // in a fresh single-sheet container to avoid propagating that style defect.
    const workbook=Workbook.create();
    const sheet=workbook.worksheets.add(name);
    const end=hourly?'E':'D';
    const range=sheet.getRange(`A1:${end}${rows.length}`);
    range.values=rows;
    range.format={font:{name:'Arial',size:10,color:'#000000',bold:false,italic:false},fill:'#FFFFFF',wrapText:true,verticalAlignment:'center',horizontalAlignment:'center',borders:{preset:'all',style:'thin',color:'#1F2329'}};
    sheet.getRange(`A1:${end}1`).format={fill:'#13284B',font:{name:'Arial',size:12,bold:true,color:'#FFFFFF'},rowHeight:30};
    const widths=hourly?[170,260,155,600,540]:[180,255,155,760];
    widths.forEach((px,j)=>sheet.getRange(`${String.fromCharCode(65+j)}1:${String.fromCharCode(65+j)}${rows.length}`).format.columnWidthPx=px);
    sheet.getRange(`D2:${end}${rows.length}`).format.horizontalAlignment='left';
    const textWidth = (s) => [...String(s)].reduce((n,c)=>n+(/[\u2e80-\uffff]/.test(c)?13.4:7.0),0);
    rows.slice(1).forEach((row,idx)=>{
      const lines=Math.max(...row.map((s,j)=>String(s).split('\n').reduce((n,p)=>n+Math.max(1,Math.ceil(textWidth(p)/(widths[j]-20))),0)));
      sheet.getRange(`A${idx+2}:${end}${idx+2}`).format.rowHeightPx=Math.max(36,lines*19+14);
    });
    if(hourly){
      sheet.freezePanes.freezeRows(1);
      for(const r of [9,11,13]) sheet.getRange(`A${r}:E${r}`).format.fill='#EEF2F7';
    }
    workbook.recalculate();
    for(const [key,r] of hourly?[['hour-top','A1:E16'],['hour-metrics','A17:E32'],['hour-rates','A33:E48'],['hour-counts','A49:E60']]:[['day-complete','A1:D15']]) {
      const blob=await workbook.render({sheetName:name,range:r,scale:1.4,format:'png'});
      await fs.writeFile(`${dir}${key}.png`,new Uint8Array(await blob.arrayBuffer()));
    }
    const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},summary:'Error scan'});
    console.log(name,errors.ndjson);
    const output=await SpreadsheetFile.exportXlsx(workbook);
    await output.save(`${dir}${name}-已补全.xlsx`);
  }
  await fs.writeFile(`${dir}expected-values.json`,JSON.stringify(expected,null,2));
  await fs.writeFile(`${dir}changes.json`,JSON.stringify(changes,null,2));
  console.log(JSON.stringify({namedTypeCells,changedCells:changes.length,fields:Object.fromEntries(Object.entries(expected).map(([k,v])=>[k,v.length-1]))}));
}
