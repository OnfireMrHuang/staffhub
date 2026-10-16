import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import LiveDatasets from './LiveDatasets';
import {monthlyCellValue,monthlyExportRows} from './LiveDatasetFields';
import {useHub} from '../store';
vi.mock('../store',async importOriginal=>{
 const actual=await importOriginal<typeof import('../store')>();
 const current=Object.assign(((selector?:(state:ReturnType<typeof actual.useHub.getState>)=>unknown)=>selector?selector(actual.useHub.getState()):actual.useHub.getState()) as typeof actual.useHub,actual.useHub);
 return {...actual,useHub:current};
});
const expected=['员工ID','员工名称','部门ID','部门名称','入职日期','是否签约竞业协议','产品ID','产品名称','直播间ID','直播间名称','直播间开播时间','年份','月份','总直播时长','夜班直播时长','早班直播时长','正常直播时长','夜班场次','早班场次','总消耗','夜班消耗','早班消耗','正常消耗','总保费','夜班保费','早班保费','正常保费','ROI','时耗','AD成本','保单成本','ROI排名','消耗排名','等待薪资天数'];
it('月度页面和导出严格使用34个业务字段及相同顺序，内部岗位和主播名单不作为列',()=>{
 const html=renderToStaticMarkup(<LiveDatasets/>);
 const headers=[...html.matchAll(/<th(?:\s[^>]*)?>([^<]*)<\/th>/g)].map(match=>match[1]);
 expect(headers).toEqual([...expected,'操作']);
 expect(html).not.toContain('2,026');
 const exported=monthlyExportRows(useHub.getState().monthlyRows);
 expect(Object.keys(exported[0])).toEqual(expected);
 expect(exported[0]['等待薪资天数']).toBe('未定义');
 expect(exported[0]['AD成本']).toBe('待定义');expect(exported[0]['保单成本']).toBe('待定义');
 expect(exported[0]).not.toHaveProperty('岗位');expect(exported[0]).not.toHaveProperty('主播');expect(exported[0]).not.toHaveProperty('直播场次');
});
it('零值和否保持可辨识，缺失的归档资料不从当前员工或直播间回填',()=>{
 const old={...useHub.getState().monthlyRows[0],nonCompeteSigned:undefined,employeeJoinedOn:undefined,roomOpenedOn:undefined};
 expect(monthlyCellValue(old,'nonCompeteSigned')).toBe('未定义');
 expect(monthlyCellValue(old,'employeeJoinedOn')).toBe('未定义');expect(monthlyCellValue(old,'roomOpenedOn')).toBe('未定义');
 expect(monthlyCellValue({...old,nonCompeteSigned:false},'nonCompeteSigned')).toBe('否');
 expect(monthlyCellValue({...old,regularPremium:0},'regularPremium')).toBe(0);
 expect(monthlyCellValue(old,'waitingSalaryDays')).toBe('未定义');
 expect(monthlyExportRows([{...old,waitingSalaryDays:0}])[0]['等待薪资天数']).toBe(0);
 expect(monthlyExportRows([{...old,waitingSalaryDays:5}])[0]['等待薪资天数']).toBe(5);
});
