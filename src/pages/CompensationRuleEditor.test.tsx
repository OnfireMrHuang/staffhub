import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ConditionBuilder from './ConditionBuilder';
import HourlyBandEditor from './HourlyBandEditor';
import { withType, withHourlyKind } from './compensation-definition';
import { CompensationRuleForm, compensationExpression, createCompensationRule } from './CompensationRuleEditor';

it('renders typed boolean, date, numeric and nested AND/OR condition controls',()=>{
 const html=renderToStaticMarkup(<ConditionBuilder value={{kind:'group',operator:'and',children:[{kind:'condition',field:'employee.nonCompeteSigned',operator:'eq',value:false},{kind:'condition',field:'employee.joined',operator:'withinMonths',value:3},{kind:'group',operator:'or',children:[{kind:'condition',field:'monthly.earlySessions',operator:'gte',value:2}]}]}} onChange={()=>{}}/>);
 expect(html).toContain('全部满足（AND）'); expect(html).toContain('任一满足（OR）'); expect(html).toContain('添加条件组'); expect(html).toContain('未签署 / 否'); expect(html).toContain('最近月数'); expect(html).toContain('type="number"');
});
it('exposes selectable count metrics and named premium items while keeping employee targeting',()=>{
 const rule=createCompensationRule('employees');
 const html=renderToStaticMarkup(<CompensationRuleForm rule={rule} rooms={[]} onChange={()=>{}}/>);
 expect(html).toContain('员工筛选条件'); expect(html).toContain('夜班场次'); expect(html).toContain('补贴计数指标'); expect(html).toContain('早班场次'); expect(html).toContain('补贴金额');
 const premium=withType(rule,'premium');
 const p=renderToStaticMarkup(<CompensationRuleForm rule={premium} rooms={[]} onChange={()=>{}}/>);
 for(const label of ['保费系数规则','新增系数项','系数项1名称','系数项1保费字段','系数项1保费系数','保费计算公式']) expect(p).toContain(label);
 expect(p).not.toContain('早班场次条件');
});
it('offers band editing with three exclusive hourly calculation modes',()=>{
 const bands=renderToStaticMarkup(<HourlyBandEditor field="roi" bands={[{keyType:'range',min:0,includeMin:true,includeMax:false,rate:20}]} onChange={()=>{}}/>);
 for(const text of ['精确数值','数值范围','关联指标范围','留空不限制','新增档位']) expect(bands).toContain(text);
 const rule=withType(createCompensationRule('global'),'hourly');
 const html=renderToStaticMarkup(<CompensationRuleForm rule={rule} rooms={[]} onChange={()=>{}}/>);
 for(const label of ['正常直播时长','时薪计算类型','统计指标加成','特殊时段加成','条件保薪','新增统计指标']) expect(html).toContain(label);
 expect(html).not.toContain('时薪取值方式');
 const special=renderToStaticMarkup(<CompensationRuleForm rule={withHourlyKind(rule,'special')} rooms={[]} onChange={()=>{}}/>);
 expect(special).toContain('加成金额');expect(special).not.toContain('新增统计指标');
 const guarantee=renderToStaticMarkup(<CompensationRuleForm rule={withHourlyKind(rule,'guarantee')} rooms={[]} onChange={()=>{}}/>);
 expect(guarantee).toContain('保薪条件');expect(guarantee).toContain('保薪值');
});

it('groups multiple selected additions before multiplying the duration',()=>{
 const rule=createCompensationRule('global');
 rule.type='hourly'; rule.hourly={duration:'hours',items:[{id:'a',name:'ROI 加成',kind:'special',rate:20},{id:'b',name:'时耗加成',kind:'special',rate:10}],formula:{mode:'additions',itemIds:['a','b']}};
 expect(compensationExpression(rule)).toBe('(ROI 加成 + 时耗加成) × 总直播时长');
 const html=renderToStaticMarkup(<CompensationRuleForm rule={rule} rooms={[]} onChange={()=>{}}/>);
 expect(html).toContain('(ROI 加成 + 时耗加成) × 总直播时长');
});

it('fixes category and places employee targeting before the shared rule definition',()=>{
 const html=renderToStaticMarkup(<CompensationRuleForm rule={createCompensationRule('employees')} rooms={[]} onChange={()=>{}}/>);
 expect(html).not.toMatch(/<select[^>]*aria-label="规则分类"/);
 expect(html.indexOf('员工筛选条件')).toBeLessThan(html.indexOf('aria-label="规则名称"'));
});
