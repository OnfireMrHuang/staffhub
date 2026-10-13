import { expect, it } from 'vitest';
import { clean, calculate } from './domain';
import { eligibleEmployeeIds, pendingRecords, seedDepartments, seedEmployees, seedFacts, seedProjects, seedRules, seedScheme, sourcePerformance } from './seed';
it('完整保留实际来源，联合主播和留资口径留在待核对区',()=>{
 expect(sourcePerformance.records).toHaveLength(190);expect(seedProjects).toHaveLength(34);expect(seedEmployees).toHaveLength(150);expect(pendingRecords).toHaveLength(7);expect(pendingRecords.filter(r=>r.joint)).toHaveLength(4);
 expect(seedFacts.filter(f=>f.model==='ad')).toHaveLength(183);
});
it('基础规则试算覆盖显式名单，未分类项目的员工整人排除而不是少算工资',()=>{
 const rows=clean(seedFacts,seedEmployees,seedDepartments,'2026-09');
 const result=calculate(rows,seedEmployees,seedDepartments,seedScheme,seedRules,'2026-09');
 expect(result.map(r=>r.employeeId).sort()).toEqual([...eligibleEmployeeIds].sort());
 expect(result.every(r=>r.fixed===0)).toBe(true);
 for(const salary of result){const projects=salary.details.flatMap(d=>d.projectIds).sort();expect(projects).toEqual(rows.filter(r=>r.employeeId===salary.employeeId).map(r=>r.projectId).sort())}
});
it('使用实际时长重算时耗，原表展示舍入值不作为时薪输入',()=>{
 const rows=clean(seedFacts,seedEmployees,seedDepartments,'2026-09');
 const source=sourcePerformance.records.find(r=>r.employeeName==='边倩'&&r.project==='平安健康-E生保')!;
 const employee=seedEmployees.find(e=>e.name==='边倩')!;const project=seedProjects.find(p=>p.name===source.project)!;const row=rows.find(r=>r.employeeId===employee.id&&r.projectId===project.id)!;
 expect(row.hours).toBe(82.8);expect(row.spend).toBe(504341.38);expect(row.premium).toBe(957319.83);expect(row.hourlySpend).toBe(source.spend!/source.actualHours!);expect(row.hourlySpend).not.toBe(source.sourceHourlySpend);
});
