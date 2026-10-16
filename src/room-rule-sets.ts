import {validateCompensationRule,type CompensationRule} from './compensation-rules';

/** A view over flat stored rules; legacy room rules each form a singleton set. */
export interface RoomRuleSet {id:string;roomIds:string[];rules:CompensationRule[]}

export const roomRuleSetId=(rule:CompensationRule):string=>rule.roomRuleSetId||rule.id;

export function listRoomRuleSets(rules:CompensationRule[]):RoomRuleSet[] {
 const sets=new Map<string,RoomRuleSet>();
 for(const rule of rules) {
  if(rule.scope!=='rooms'||rule.deletedAt) continue;
  const id=roomRuleSetId(rule),existing=sets.get(id);
  if(existing) existing.rules.push(rule);
  else sets.set(id,{id,roomIds:[...rule.roomIds],rules:[rule]});
 }
 return [...sets.values()];
}

export function validateRoomRuleSet(set:RoomRuleSet):void {
 if(!set || typeof set.id!=='string' || !set.id.trim()) throw new Error('直播间规则集 ID 不能为空');
 if(!Array.isArray(set.roomIds) || !set.roomIds.length || set.roomIds.some(id=>typeof id!=='string'||!id.trim()) || new Set(set.roomIds).size!==set.roomIds.length) throw new Error('规则集必须选择有效且不重复的直播间');
 if(!Array.isArray(set.rules) || !set.rules.length || set.rules.length>3) throw new Error('直播间规则集必须包含 1 至 3 条子规则');
 if(new Set(set.rules.map(rule=>rule?.id)).size!==set.rules.length) throw new Error('规则集子规则 ID 重复');
 if(new Set(set.rules.map(rule=>rule?.type)).size!==set.rules.length) throw new Error('规则集每种计算类型最多配置一条子规则');
 for(const rule of set.rules) {
  validateCompensationRule(rule);
  if(rule.deletedAt) throw new Error('规则集包含已删除的子规则');
  if(rule.scope!=='rooms' || (rule.roomRuleSetId!==undefined && rule.roomRuleSetId!==set.id)) throw new Error('子规则的直播间规则集归属无效');
  if(rule.roomIds.length!==set.roomIds.length || rule.roomIds.some(id=>!set.roomIds.includes(id))) throw new Error('规则集子规则必须共用相同直播间');
 }
}
