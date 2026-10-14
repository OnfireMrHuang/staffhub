import { beforeEach, expect, it } from 'vitest';
import { useHub } from '../store';
import { monthlyRowKey } from '../dataset-corrections';
import { monthlyCorrectionIdentity } from './datasetCorrectionSelection';

beforeEach(()=>useHub.getState().reset());

it('月度行移动后，编辑与恢复使用当前键，修订历史保留原键及原月份',()=>{
 const s=useHub.getState(),original=s.monthlyRows[0];
 const moved={...original,employeeId:'moved-employee',roomId:'moved-room',month:'2026-11',year:2026};
 const originalKey=monthlyRowKey(original),currentKey=monthlyRowKey(moved);
 expect(monthlyCorrectionIdentity(moved,[{key:originalKey,sourceMonth:original.month,row:moved}])).toEqual({key:currentKey,auditKey:originalKey,sourceMonth:original.month});
 expect(monthlyCorrectionIdentity(original,[])).toEqual({key:originalKey,auditKey:originalKey,sourceMonth:original.month});
});

it('界面选中移动后的月度行，可以再次保存和恢复，审计始终指向原行',()=>{
 const initial=useHub.getState(),original=initial.monthlyRows[0],originalKey=monthlyRowKey(original);
 const employee=initial.employees.find(e=>e.id===original.employeeId)!,room=initial.rooms.find(r=>r.id===original.roomId)!;
 useHub.setState({session:{kind:'admin',username:'ui-test',method:'password'},employees:[...initial.employees,{...employee,id:'moved-employee',name:'移入员工',status:'在职',joined:'2026-01-01'}],rooms:[...initial.rooms,{...room,id:'moved-room',name:'移入直播间',platformAccountId:'moved-room-account'}]});
 useHub.getState().saveDatasetCorrection('monthly',originalKey,{employeeId:'moved-employee',roomId:'moved-room',month:'2026-11'},'关联移入',initial.dataset.version);
 useHub.getState().setMonth('2026-11');
 const movedState=useHub.getState(),moved=movedState.monthlyRows.find(r=>r.employeeId==='moved-employee')!;
 expect(moved).toBeDefined();
 const identity=monthlyCorrectionIdentity(moved,movedState.monthlyOverrides);
 expect(identity.key).toBe(monthlyRowKey(moved));
 expect(identity.auditKey).toBe(originalKey);
 movedState.saveDatasetCorrection('monthly',identity.key,{premium:moved.premium+100},'移入后再次核对',movedState.dataset.version);
 const revised=useHub.getState();
 expect(revised.monthlyRows.find(r=>r.employeeId==='moved-employee')?.premium).toBe(moved.premium+100);
 revised.restoreDatasetCorrection('monthly',identity.key,'移入后恢复自动',revised.dataset.version);
 expect(useHub.getState().monthlyOverrides).toHaveLength(0);
 expect(useHub.getState().correctionAudit.map(a=>a.key)).toEqual([originalKey,originalKey,originalKey]);
 expect(useHub.getState().correctionAudit.map(a=>a.action)).toEqual(['修改','修改','恢复自动']);
});
