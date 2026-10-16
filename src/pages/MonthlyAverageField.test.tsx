import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DatasetCorrectionEditor from './DatasetCorrectionEditor';
import DatasetCorrectionHistory from './DatasetCorrectionHistory';
import LiveDatasetSchema from './LiveDatasetSchema';
import { useHub } from '../store';
import { monthlyRowKey, type CorrectionAudit } from '../dataset-corrections';

vi.mock('../store', async importOriginal => {
 const actual = await importOriginal<typeof import('../store')>();
 const current = Object.assign(((selector?: (state: ReturnType<typeof actual.useHub.getState>) => unknown) => selector ? selector(actual.useHub.getState()) : actual.useHub.getState()) as typeof actual.useHub, actual.useHub);
 return { ...actual, useHub: current };
});
// Radix portals render no server HTML; inline only their presentation boundary.
vi.mock('../components', async importOriginal => ({
 ...await importOriginal<typeof import('../components')>(),
 Modal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <section>{children}</section> : null,
}));

it('月度编辑显示可留空的小数时薪输入，表结构区分时薪与时长', () => {
 const state = useHub.getState(), row = { ...state.monthlyRows[0], past3MonthsAvgHourlyRate: undefined };
 const html = renderToStaticMarkup(<DatasetCorrectionEditor selection={{ table:'monthly', row, key:monthlyRowKey(row), sourceMonth:row.month, version:state.dataset.version }} onClose={() => {}} />);
 expect(html).toContain('过去3个月的平均时薪<input type="number" min="0" step="any" placeholder="未定义（元/小时，可留空）" value=""');
 const schema = renderToStaticMarkup(<LiveDatasetSchema table="monthly" open onClose={() => {}} />);
 const field = [...schema.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].find(match => match[1].includes('过去3个月的平均时薪'))?.[1] ?? '';
 expect(field).toContain('past3MonthsAvgHourlyRate');
 expect(field).toContain('时薪 / 元每小时');
 expect(field).toContain('常规指标');
 expect(field).toContain('不自动推算');
});

it('修订记录将平均时薪展示为金额数值，不误判为百分比', () => {
 const before = useHub.getState().monthlyRows[0];
 const audit: CorrectionAudit = { id:'average-rate', table:'monthly', key:monthlyRowKey(before), sourceMonth:before.month, targetMonth:before.month, reason:'核对历史时薪', operator:'HR', at:'2026-10-16 12:00:00', action:'修改', before, after:{ ...before, past3MonthsAvgHourlyRate:62.75 } };
 const html = renderToStaticMarkup(<DatasetCorrectionHistory audits={[audit]} scope="员工月度汇总" onClose={() => {}} />);
 expect(html).toContain('<td>过去3个月的平均时薪</td><td>未定义</td><td>62.75</td>');
 expect(html).not.toContain('6,275');
 expect(html).not.toContain('%');
});
