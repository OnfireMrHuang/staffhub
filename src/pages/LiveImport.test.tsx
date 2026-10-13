import { expect, it } from 'vitest';
import { parseLiveImport } from './LiveImport';
import type { Employee, Project } from '../domain';
const employees=[{id:'e1',name:'王甲'},{id:'e2',name:'李乙'},{id:'e3',name:'赵丙'}] as Employee[];
const projects=[{id:'p1',code:'P01',name:'甲项目'}] as Project[];
const row={'项目编码':'P01','项目名称':'甲项目','投放日期':'2026-10-12','开始时间':'00:00','结束时间':'01:00','主播':' 王甲 ','投手':'李乙','场控':'赵丙'};
it('姓名解析稳定ID且不要求项目员工关联，编辑保留ID并递增版本',()=>{
 const result=parseLiveImport([{...row,'记录ID':'r1','版本':2}],employees,projects,[{id:'r1',projectId:'p1',date:'2026-10-12',start:'00:00',end:'01:00',hostId:'e1',buyerId:'e2',controlId:'e3',version:2}]);
 expect(result[0]).toMatchObject({id:'r1',projectId:'p1',hostId:'e1',buyerId:'e2',controlId:'e3',version:3});
});
it('未知姓名、重名和项目编码名称错误反馈具体行号',()=>{
 expect(()=>parseLiveImport([row,{...row,'主播':'未知'}],employees,projects,[])).toThrow('第 3 行：主播');
 expect(()=>parseLiveImport([row],employees, [{...projects[0],name:'其他'}],[])).toThrow('第 2 行：项目名称');
 expect(()=>parseLiveImport([row],[...employees,{...employees[0],id:'e4'}],projects,[])).toThrow('姓名存在重复');
});
it('导入已有ID须提供当前版本，重复ID和空人员不写入',()=>{
 const existing=[{id:'r1',projectId:'p1',date:'2026-10-12',start:'00:00',end:'01:00',hostId:'e1',buyerId:'e2',controlId:'e3',version:2}];
 expect(()=>parseLiveImport([{...row,'记录ID':'r1','版本':1}],employees,projects,existing)).toThrow('版本');
 expect(()=>parseLiveImport([{...row,'记录ID':'same'},{...row,'记录ID':'same'}],employees,projects,[])).toThrow('记录ID重复');
 expect(()=>parseLiveImport([{...row,'场控':''}],employees,projects,[])).toThrow('场控');
});

it('Excel来源行号在空行后仍准确',()=>{
 expect(()=>parseLiveImport([{...row,'主播':'未知',__rowNum__:8}],employees,projects,[])).toThrow('第 9 行：主播');
});

it('Excel数值时间不能将分钟秒数舍入为整小时',()=>{
 expect(()=>parseLiveImport([{...row,'开始时间':1/86400}],employees,projects,[])).toThrow('开始时间仅支持整小时');
 expect(parseLiveImport([{...row,'开始时间':1/24,'结束时间':2/24}],employees,projects,[])[0]).toMatchObject({start:'01:00',end:'02:00'});
});
