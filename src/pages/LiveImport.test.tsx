import { expect, it } from 'vitest';
import { parseLiveImport } from './LiveImport';
import type { Employee } from '../domain';
import type { AdvertisingProduct, LiveRoom } from '../operations-domain';
import type { LiveRecord } from '../live-domain';
const employees=[{id:'e1',name:'王甲'},{id:'e2',name:'李乙'},{id:'e3',name:'赵丙'}] as Employee[];
const products=[{id:'PRODUCT01',name:'甲产品',platform:'巨量引擎',accountId:'AD01',active:true}] satisfies AdvertisingProduct[];
const rooms=[{id:'ROOM01',name:'甲直播间',productId:'PRODUCT01',platformAccountId:'LIVE01',active:true}] satisfies LiveRoom[];
const row={'产品ID':'PRODUCT01','产品名称':'甲产品','直播间ID':'ROOM01','直播间名称':'甲直播间','投放日期':'2026-10-12','开始时间':'00:00','结束时间':'01:00','主播':' 王甲 ','投手':'李乙','场控':'赵丙'};
const existing=[{id:'r1',productId:'PRODUCT01',roomId:'ROOM01',date:'2026-10-12',start:'00:00',end:'01:00',hostId:'e1',buyerId:'e2',controlId:'e3',version:2}] satisfies LiveRecord[];
const parse=(rows:Record<string,unknown>[],old:LiveRecord[]=[])=>parseLiveImport(rows,employees,rooms,products,old);
it('四个业务字段解析稳定ID，姓名与编辑版本保持一致',()=>{
 expect(parse([{...row,'记录ID':'r1','版本':2}],existing)[0]).toMatchObject({id:'r1',productId:'PRODUCT01',roomId:'ROOM01',hostId:'e1',buyerId:'e2',controlId:'e3',version:3});
});
it('导入必须包含四个字段，校验名称及当前产品直播间关系',()=>{
 expect(()=>parse([{...row,'产品ID':''}])).toThrow('均必填');
 expect(()=>parse([{...row,'直播间名称':'其他'}])).toThrow('直播间名称');
 expect(()=>parse([{...row,'产品名称':'其他'}])).toThrow('产品名称');
 expect(()=>parseLiveImport([row],employees,[{...rooms[0],productId:'PRODUCT02'}],products,[])).toThrow('关联不一致');
 expect(()=>parse([{'投放项目编码':'P01','投放项目名称':'甲项目'}])).toThrow('当前模板');
});
it('ID与名称使用NFKC规范化，避免全半角差异',()=>{
 expect(parse([{...row,'产品ID':'ＰＲＯＤＵＣＴ０１','直播间ID':'ＲＯＯＭ０１'}])[0].roomId).toBe('ROOM01');
 expect(parseLiveImport([{...row,'产品名称':'A产品'}],employees,rooms,[{...products[0],name:'Ａ产品'}],[])[0].productId).toBe('PRODUCT01');
});
it('未知姓名和重名反馈具体行号',()=>{
 expect(()=>parse([row,{...row,'主播':'未知'}])).toThrow('第 3 行：主播');
 expect(()=>parseLiveImport([row],[...employees,{...employees[0],id:'e4'}],rooms,products,[])).toThrow('姓名存在重复');
});
it('已有ID须提供当前版本，重复ID和空人员不写入',()=>{
 expect(()=>parse([{...row,'记录ID':'r1','版本':1}],existing)).toThrow('版本');
 expect(()=>parse([{...row,'记录ID':'same'},{...row,'记录ID':'same'}])).toThrow('记录ID重复');
 expect(()=>parse([{...row,'场控':''}])).toThrow('场控');
});
it('Excel来源行号在空行后仍准确',()=>{
 expect(()=>parse([{...row,'主播':'未知',__rowNum__:8}])).toThrow('第 9 行：主播');
});
it('Excel数值时间不能将分钟秒数舍入为整小时',()=>{
 expect(()=>parse([{...row,'开始时间':1/86400}])).toThrow('开始时间仅支持整小时');
 expect(parse([{...row,'开始时间':1/24,'结束时间':2/24}])[0]).toMatchObject({start:'01:00',end:'02:00'});
});
