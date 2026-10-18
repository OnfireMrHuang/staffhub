import { expect, it } from 'vitest';
import { normalizeOperationSection, operationSections } from './operations-navigation';
it('运营数据管理六个二级入口按业务顺序排列',()=>{
 expect(operationSections.map(item=>item.label)).toEqual(['投放产品','直播间','直播原始统计数据','时报','日报','员工月度汇总']);
 expect(new Set(operationSections.map(item=>item.id)).size).toBe(6);
});
it('旧导航跳转兼容，未知入口安全进入统一月度表',()=>{
 expect(normalizeOperationSection('projects')).toBe('rooms');
 expect(normalizeOperationSection('input')).toBe('raw');
 expect(normalizeOperationSection('datasets')).toBe('monthly');
 for(const item of operationSections) expect(normalizeOperationSection(item.id)).toBe(item.id);
 expect(normalizeOperationSection('missing')).toBe('monthly');
 expect(normalizeOperationSection(undefined)).toBe('monthly');
});
