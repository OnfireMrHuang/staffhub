import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CompensationRuleDefinition, { withValidatedHourlyItem } from './CompensationRuleDefinition';
import { createCompensationRule, withType } from './compensation-definition';

it('asks for the calculation type before the rule name in a single-rule form',()=>{
 const html=renderToStaticMarkup(<CompensationRuleDefinition rule={createCompensationRule('global')} onChange={()=>{}}/>);
 expect(html.indexOf('aria-label="计算类型"')).toBeLessThan(html.indexOf('aria-label="规则名称"'));
});

it('keeps a room-set child calculation type fixed while exposing its configuration',()=>{
 const rule=withType(createCompensationRule('rooms'),'premium');
 const html=renderToStaticMarkup(<CompensationRuleDefinition rule={rule} lockType onChange={()=>{}}/>);
 expect(html).toMatch(/<input[^>]*aria-label="计算类型"[^>]*readOnly=""[^>]*value="保费系数规则"/);
 expect(html).not.toMatch(/<select[^>]*aria-label="计算类型"/);
 expect(html.indexOf('aria-label="计算类型"')).toBeLessThan(html.indexOf('aria-label="规则名称"'));
 expect(html).toContain('系数项1保费系数');
});

it('saves a room-set hourly metric while preserving the child group identity',()=>{
 const rule={...withType(createCompensationRule('rooms'),'hourly'),roomRuleSetId:'room-set-a',roomIds:['room-a']};
 const saved=withValidatedHourlyItem(rule,{id:'metric-a',name:'ROI 加成',kind:'metric',field:'roi',bands:[{keyType:'range',min:0,includeMin:true,includeMax:false,rate:20}]});
 expect(saved.roomRuleSetId).toBe('room-set-a');
 expect(saved.scope).toBe('rooms');
 expect(saved.roomIds).toEqual(['room-a']);
 expect(saved.hourly?.items[0].name).toBe('ROI 加成');
 expect(saved.hourly?.formula).toEqual({mode:'additions',itemIds:['metric-a']});
 expect(rule.hourly?.items).toEqual([]);
});
