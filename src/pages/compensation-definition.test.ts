import {expect,it} from 'vitest';
import {compensationExpression,createCompensationRule,editableCompensationRule,withHourlyItems,withHourlyKind,withType} from './compensation-definition';
import {validateCompensationRule,type HourlyItem} from '../compensation-rules';
it('keeps the automatic formula in sync when metric items are renamed, added, reordered or deleted',()=>{
 let rule=withType(createCompensationRule('global'),'hourly');
 const a:HourlyItem={id:'a',name:'ROI',kind:'metric',field:'roi',bands:[{keyType:'range',min:0,includeMin:true,includeMax:false,rate:20}]},b={...a,id:'b',name:'时耗',field:'hourlySpend'};
 rule=withHourlyItems(rule,[a,b]);expect(compensationExpression(rule)).toBe('(ROI + 时耗) × 总直播时长');
 rule=withHourlyItems(rule,[{...b,name:'消耗时薪'},a]);expect(compensationExpression(rule)).toBe('(消耗时薪 + ROI) × 总直播时长');
 rule=withHourlyItems(rule,[a]);expect(rule.hourly!.formula).toEqual({mode:'additions',itemIds:['a']});expect(compensationExpression(rule)).toBe('ROI × 总直播时长');
 rule=withHourlyItems(rule,[]);expect(()=>validateCompensationRule({...rule,name:'规则',version:1})).toThrow();
});
it('switches hourly subtype without carrying hidden metrics and preserves chosen scope and duration',()=>{
 let rule=withType(createCompensationRule('rooms'),'hourly');rule.roomIds=['r'];rule.hourly!.duration='nightHours';
 rule=withHourlyKind(rule,'special');expect(rule.hourly!.items).toHaveLength(1);expect(rule.hourly!.formula).toEqual({mode:'additions',itemIds:[rule.hourly!.items[0].id]});
 rule=withHourlyKind(rule,'guarantee');expect(rule.hourly).toMatchObject({kind:'guarantee',duration:'nightHours',items:[{kind:'guarantee',condition:{children:[]}}]});expect(rule.scope).toBe('rooms');expect(rule.roomIds).toEqual(['r']);
 rule=withHourlyKind(rule,'metric');expect(rule.hourly!.items).toEqual([]);expect(rule.hourly!.formula).toEqual({mode:'additions',itemIds:[]});
});
it('prepares old rules for editing without changing persisted rules or their frozen configuration',()=>{
 const source={...createCompensationRule('global'),definitionVersion:undefined,type:'premium' as const,allowance:undefined,premium:{normalField:'regularPremium' as const,earlyField:'earlyPremium' as const,coefficient:1.5,condition:{kind:'group' as const,operator:'and' as const,children:[{kind:'condition' as const,field:'monthly.earlySessions',operator:'gt' as const,value:20}]}}};
 const before=structuredClone(source),draft=editableCompensationRule(source);
 expect(draft.premium).toMatchObject({items:[{name:'正常保费',field:'regularPremium',coefficient:1},{name:'早班保费',field:'earlyPremium',coefficient:1.5}]});expect(source).toEqual(before);
});
it('removes legacy addition conditions from the editable template without altering the original',()=>{
 const source=withType(createCompensationRule('global'),'hourly');
 source.definitionVersion=undefined;source.name='旧统计指标';source.version=1;
 source.hourly!.kind=undefined;
 const item:HourlyItem={id:'legacy',name:'ROI',kind:'metric',field:'roi',condition:{kind:'group',operator:'and',children:[{kind:'condition',field:'monthly.earlySessions',operator:'gt',value:0}]},bands:[{keyType:'range',min:0,includeMin:true,includeMax:false,rate:20}]};
 source.hourly!.items=[item];source.hourly!.formula={mode:'additions',itemIds:[item.id]};
 const draft=editableCompensationRule(source);
 expect(draft.hourly!.items[0].condition).toBeUndefined();expect(source.hourly!.items[0].condition).toBeDefined();
 expect(()=>validateCompensationRule(draft)).not.toThrow();
});

it('converts exact bands to equal inclusive bounds only in the editable copy, including v2 rules',()=>{
 let source=withType(createCompensationRule('global'),'hourly');source.name='原档位';source.version=1;
 source=withHourlyItems(source,[{id:'metric',name:'ROI',kind:'metric',field:'roi',bands:[{keyType:'exact',exact:1.6,includeMin:false,includeMax:false,rate:60}]}]);
 const draft=editableCompensationRule(source);
 expect(draft.hourly!.items[0].bands).toEqual([{keyType:'range',min:1.6,max:1.6,includeMin:true,includeMax:true,rate:60}]);
 expect(source.hourly!.items[0].bands![0].keyType).toBe('exact');
 expect(()=>validateCompensationRule(draft)).not.toThrow();
});
