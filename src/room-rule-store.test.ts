import {beforeEach,expect,it} from 'vitest';
import {useHub} from './store';
import type {CompensationRule} from './compensation-rules';
import {scheduleTestMonth} from './payroll-test-fixtures';
import {createCompensationRule} from './pages/compensation-definition';

beforeEach(()=>{
 useHub.getState().reset();useHub.setState({session:{kind:'admin',username:'admin',method:'password'},compensationRules:[],publishedCompensationRules:[],compensationTasks:[],payrollTasks:[]});
 scheduleTestMonth();
});
const draft=():CompensationRule=>({...createCompensationRule('rooms'),id:'room-rule',name:'直播间夜班补贴',roomIds:[useHub.getState().rooms[0].id]});

it('saves and publishes one rule, then creates a single calculation input without group metadata',()=>{
 const s=useHub.getState(),rule=draft();s.saveCompensationRule(rule);
 expect(useHub.getState().compensationRules).toHaveLength(1);
 expect(useHub.getState().compensationRules[0]).toMatchObject({version:1,status:'草稿',roomIds:rule.roomIds,type:'allowance'});
 s.publishCompensationRule(rule.id);s.runPayroll();
 const task=useHub.getState().compensationTasks[0];
 expect(useHub.getState().compensationTasks).toHaveLength(1);
 expect(task.ruleId).toBe(rule.id);expect(task.status).toBe('已核算');
 expect(task.roomRuleSet).toBeUndefined();expect(task.rule.roomRuleSetId).toBeUndefined();
 const rows=useHub.getState().batch!.compensationResult!.rows;
 expect(rows.every(row=>row.premium.after===row.premium.before)).toBe(true);
 expect(rows.filter(row=>rule.roomIds.includes(row.roomId)).every(row=>row.total===row.statistics!.nightSessions!*20)).toBe(true);
});

it('edits only its own draft and uses the last published version until republished',()=>{
 const s=useHub.getState(),rule=draft();s.saveCompensationRule(rule);s.publishCompensationRule(rule.id);
 const first=structuredClone(useHub.getState().publishedCompensationRules[0]);
 s.saveCompensationRule({...rule,name:'新补贴',allowance:{field:'nightSessions',amount:35}});
 expect(useHub.getState().publishedCompensationRules[0]).toEqual(first);
 s.publishCompensationRule(rule.id);s.runPayroll();
 const task=useHub.getState().compensationTasks[0];
 expect(task).toMatchObject({ruleName:'新补贴',ruleVersion:2});
 expect(task.rule.allowance?.amount).toBe(35);
 expect(()=>s.publishCompensationRule(rule.id)).toThrow(/重复/);
});

it('allows one rule to cover multiple rooms while preventing a second rule for any of them',()=>{
 const s=useHub.getState(),roomIds=s.rooms.slice(0,2).map(room=>room.id),rule={...draft(),roomIds};s.saveCompensationRule(rule);
 for(const roomId of roomIds)expect(()=>s.saveCompensationRule({...draft(),id:`other-${roomId}`,roomIds:[roomId]})).toThrow(/占用/);
 expect(useHub.getState().compensationRules).toHaveLength(1);
 s.publishCompensationRule(rule.id);s.runPayroll();
 expect(useHub.getState().compensationTasks).toHaveLength(1);
 expect(useHub.getState().compensationTasks[0].rule.roomIds).toEqual(roomIds);
});

it('rejects attempts to create grouped rules at both save and publication boundaries',()=>{
 const s=useHub.getState(),grouped={...draft(),version:1,roomRuleSetId:'unsupported-group'};
 expect(()=>s.saveCompensationRule(grouped)).toThrow(/仅支持单条/);
 expect(useHub.getState().compensationRules).toEqual([]);
 useHub.setState({compensationRules:[grouped]});
 expect(()=>s.publishCompensationRule(grouped.id)).toThrow(/仅支持单条/);
 expect(useHub.getState().publishedCompensationRules).toEqual([]);
});

it('deleting one room rule releases its room and leaves the calculated snapshot unchanged',()=>{
 const s=useHub.getState(),rule=draft();s.saveCompensationRule(rule);s.publishCompensationRule(rule.id);s.runPayroll();
 const snapshot=structuredClone(useHub.getState().batch);s.deleteCompensationRule(rule.id);
 expect(useHub.getState().publishedCompensationRules).toEqual([]);
 expect(useHub.getState().batch).toEqual(snapshot);
 s.saveCompensationRule({...rule,id:'replacement'});
 expect(useHub.getState().compensationRules.filter(rule=>!rule.deletedAt).map(rule=>rule.id)).toEqual(['replacement']);
});
