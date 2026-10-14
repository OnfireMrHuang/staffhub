import * as XLSX from 'xlsx';
import type { Employee } from '../domain';
import type { AdvertisingProduct, LiveRoom } from '../operations-domain';
import type { LiveRecord } from '../live-domain';
const text=(v:unknown)=>String(v??'').normalize('NFKC').trim();
function dateValue(v:unknown){if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`}return text(v)}
function timeValue(v:unknown){if(typeof v==='number'&&v>=0&&v<=1){const actualMinutes=v*1440,minutes=Math.round(actualMinutes);if(Math.abs(actualMinutes-minutes)>1e-7||minutes%60!==0)throw new Error('整小时');return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`}return text(v)}
export function parseLiveImport(rows:Record<string,unknown>[],employees:Employee[],rooms:LiveRoom[],products:AdvertisingProduct[],existing:LiveRecord[]):LiveRecord[]{
 const ids=new Set<string>();const records:LiveRecord[]=[];
 rows.forEach((r,i)=>{if(Object.values(r).every(v=>text(v)===''))return;const fail=(message:string):never=>{throw new Error(`第 ${typeof r.__rowNum__==='number'?Number(r.__rowNum__)+1:i+2} 行：${message}`)};
 const productId=text(r['产品ID']),productName=text(r['产品名称']),roomId=text(r['直播间ID']),roomName=text(r['直播间名称']);
 if(!productId||!productName||!roomId||!roomName)fail('产品ID、产品名称、直播间ID和直播间名称均必填，请使用当前模板');
 const productMatches=products.filter(p=>text(p.id)===productId);if(productMatches.length!==1)fail('产品ID须匹配唯一产品');const p=productMatches[0];if(productName!==text(p.name))fail('产品名称与产品ID不一致');
 const roomMatches=rooms.filter(room=>text(room.id)===roomId);if(roomMatches.length!==1)fail('直播间ID须匹配唯一直播间');const room=roomMatches[0];if(roomName!==text(room.name))fail('直播间名称与直播间ID不一致');if(room.productId!==p.id)fail('直播间与产品关联不一致，请使用当前产品和直播间关系');
 const person=(field:string)=>{const value=text(r[field]);if(!value)fail(`${field}不能为空`);const found=employees.filter(e=>text(e.name)===value);if(!found.length)fail(`${field}姓名“${value}”不存在`);if(found.length!==1)fail(`${field}姓名存在重复，请先修正员工档案`);return found[0].id};
 const time=(field:string)=>{try{return timeValue(r[field])}catch{return fail(`${field}仅支持整小时，不能将分钟或秒舍入`)}};
 const id=text(r['记录ID'])||`live-${crypto.randomUUID()}`;if(ids.has(id))fail('记录ID重复');ids.add(id);const previous=existing.find(x=>x.id===id);if(previous&&Number(r['版本'])!==previous.version)fail(`记录版本已变化或缺失，应为 ${previous.version}，请重新导出后编辑`);if(!previous&&r['版本']!==undefined&&text(r['版本'])!==''&&Number(r['版本'])!==1)fail('新记录版本须为 1');
 records.push({id,productId:p.id,roomId:room.id,date:dateValue(r['投放日期']),start:time('开始时间'),end:time('结束时间'),hostId:person('主播'),buyerId:person('投手'),controlId:person('场控'),version:(previous?.version??0)+1});
 });if(!records.length)throw new Error('直播记录表为空，请使用模板填写人员后上传');return records;
}
