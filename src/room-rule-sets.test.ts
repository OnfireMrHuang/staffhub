import {expect,it} from 'vitest';
import {compensationRoomOwners,validateCompensationRoomOwnership,validateCompensationRule,type CompensationRule} from './compensation-rules';
import {listRoomRuleSets,roomRuleSetId,validateRoomRuleSet} from './room-rule-sets';

const rule=(id:string,values:Partial<CompensationRule>={}):CompensationRule=>({id,name:id,version:1,status:'草稿',scope:'rooms',roomIds:['r1'],type:'allowance',allowance:{field:'nightSessions',amount:20},...values});

it('presents legacy room rules as singleton groups without changing persisted rules',()=>{
 const legacy=rule('legacy'),before=structuredClone(legacy);
 const rules=[legacy,rule('a',{roomRuleSetId:'set'}),rule('h',{roomRuleSetId:'set'}),rule('deleted',{deletedAt:'now'}),rule('global',{scope:'global',roomIds:[]})];
 expect(listRoomRuleSets(rules).map(set=>({id:set.id,roomIds:set.roomIds,rules:set.rules.map(item=>item.id)}))).toEqual([{id:'legacy',roomIds:['r1'],rules:['legacy']},{id:'set',roomIds:['r1'],rules:['a','h']}]);
 expect(roomRuleSetId(legacy)).toBe('legacy');expect(legacy).toEqual(before);
});

it('excludes every sibling from room picker ownership but rejects forged membership',()=>{
 const rules=[rule('a',{roomRuleSetId:'set'}),rule('b',{roomRuleSetId:'set'}),rule('other',{roomIds:['r2'],roomRuleSetId:'other-set'})];
 expect([...compensationRoomOwners(rules,'a').keys()]).toEqual(['r2']);
 expect([...compensationRoomOwners(rules,'set').keys()]).toEqual(['r2']);
 expect(()=>validateCompensationRoomOwnership({...rule('a'),roomRuleSetId:'set'},rules)).not.toThrow();
 expect(()=>validateCompensationRoomOwnership(rule('imposter',{roomRuleSetId:'set'}),rules)).toThrow(/占用/);
 expect(()=>validateCompensationRoomOwnership(rule('set'),rules)).toThrow(/归属|规则集/);
 expect(()=>validateCompensationRoomOwnership(rule('other',{roomRuleSetId:'set'}),rules)).toThrow(/归属|规则集/);
});

it('validates group type uniqueness, shared rooms, scope, member identity and optional membership',()=>{
 const base=rule('a'),hourly:CompensationRule={...rule('h'),type:'hourly',allowance:undefined,hourly:{duration:'hours',items:[{id:'i',name:'加成',kind:'special',rate:30}],formula:{mode:'additions',itemIds:['i']}}};
 expect(()=>validateRoomRuleSet({id:'set',roomIds:['r1'],rules:[base,hourly]})).not.toThrow();
 for(const rules of [[],[base,rule('b')],[base,{...hourly,id:'a'}],[{...base,roomIds:['r2']}],[{...base,scope:'global' as const,roomIds:[]}],[{...base,roomRuleSetId:'another'}]]) expect(()=>validateRoomRuleSet({id:'set',roomIds:['r1'],rules})).toThrow();
 expect(()=>validateCompensationRule({...base,scope:'global',roomIds:[],roomRuleSetId:'set'})).toThrow(/规则集/);
 expect(()=>validateCompensationRule({...base,roomRuleSetId:' '})).toThrow(/规则集/);
});
