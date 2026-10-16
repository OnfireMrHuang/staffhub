import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompensationRule } from '../compensation-rules';
import type { LiveRoom } from '../operations-domain';
import type { RoomRuleSet } from '../room-rule-sets';
import { createCompensationRule } from './compensation-definition';
import { prepareRoomRuleSetDraft, RoomRuleSetForm } from './RoomRuleSetEditor';

const rooms:LiveRoom[]=[{id:'room-a',name:'一号直播间',active:true,openedOn:'2025-01-01',platformAccountId:'account-a',productId:'product-a'}];
const initial:RoomRuleSet={id:'set-a',roomIds:['room-a'],rules:[{...createCompensationRule('rooms'),id:'allowance-a',name:'夜班补贴',roomIds:['room-a'],version:1}]};
const props={initial,rooms,rules:initial.rules,onSave:()=>{},onClose:()=>{}};

it('starts existing children collapsed with inspectable summaries after the room picker',()=>{
 const html=renderToStaticMarkup(<RoomRuleSetForm {...props}/>);
 expect(html.indexOf('选择适用直播间')).toBeLessThan(html.indexOf('夜班补贴'));
 expect(html).toContain('夜班场次 × 20 元');
 expect(html).toContain('编辑补贴规则');
 expect(html).not.toContain('aria-label="规则名称"');
 expect(html).toMatch(/<option[^>]*value="allowance"[^>]*disabled=""/);
});

it('requires rooms before exposing the calculation type chooser',()=>{
 const html=renderToStaticMarkup(<RoomRuleSetForm {...props} initial={{id:'empty-set',roomIds:[],rules:[]}}/>);
 expect(html).toContain('选择适用直播间');
 expect(html).not.toContain('aria-label="新增规则计算类型"');
 expect(html).not.toContain('aria-label="规则名称"');
});

it('allows opening read-only child details without exposing mutation actions',()=>{
 const html=renderToStaticMarkup(<RoomRuleSetForm {...props} readOnly/>);
 expect(html).toMatch(/<button(?![^>]*disabled)[^>]*aria-label="查看补贴规则"/);
 expect(html).not.toContain('aria-label="新增规则计算类型"');
 expect(html).not.toContain('删除补贴规则');
 expect(html).not.toContain('保存草稿');
});

it('prepares a complete group with shared rooms and membership without changing the source',()=>{
 const draft={...initial,roomIds:['room-b']};
 const saved=prepareRoomRuleSetDraft(draft);
 expect(saved.rules[0]).toMatchObject({scope:'rooms',roomIds:['room-b'],roomRuleSetId:'set-a'});
 expect(initial.rules[0].roomIds).toEqual(['room-a']);
 expect(initial.rules[0].roomRuleSetId).toBeUndefined();
 saved.rules[0].allowance!.amount=100;
 expect(initial.rules[0].allowance!.amount).toBe(20);
});

it('rejects incomplete and duplicate-type rows rather than dropping them on group save',()=>{
 expect(()=>prepareRoomRuleSetDraft({...initial,rules:[{...initial.rules[0],name:''}]})).toThrow();
 expect(()=>prepareRoomRuleSetDraft({...initial,rules:[initial.rules[0],{...initial.rules[0],id:'second-allowance'}]})).toThrow();
 expect(()=>prepareRoomRuleSetDraft({...initial,rules:[]})).toThrow();
});

it('preserves an untouched legacy definition and accepts a new child version for draft saving',()=>{
 const legacy:CompensationRule={id:'old-premium',name:'原保费规则',version:0,status:'草稿',scope:'rooms',roomIds:['room-a'],type:'premium',premium:{normalField:'regularPremium',earlyField:'earlyPremium',coefficient:1.8,condition:{kind:'group',operator:'and',children:[{kind:'condition',field:'monthly.earlySessions',operator:'gte',value:3}]}}};
 const saved=prepareRoomRuleSetDraft({...initial,rules:[legacy]});
 expect(saved.rules[0].definitionVersion).toBeUndefined();
 expect(saved.rules[0].version).toBe(0);
 expect(saved.rules[0].premium).toEqual(legacy.premium);
});
