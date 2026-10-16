import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HourlyBandEditor, { hourlyBandSummary } from './HourlyBandEditor';
import type { NewRuleBand } from '../compensation-rules';

const range:NewRuleBand={keyType:'range',min:0,max:1.6,includeMin:true,includeMax:false,rate:40};

it('summarizes exact, open, closed and related bounds without changing their meaning',()=>{
 const cases:[NewRuleBand,string][]=[
  [range,'0 ≤ 有效 ROI < 1.6 → 40 元/小时'],
  [{...range,min:undefined},'有效 ROI < 1.6 → 40 元/小时'],
  [{...range,min:1.6,max:undefined,includeMin:false},'有效 ROI > 1.6 → 40 元/小时'],
  [{...range,min:1.6,max:undefined},'有效 ROI ≥ 1.6 → 40 元/小时'],
  [{...range,includeMin:false,includeMax:true},'0 < 有效 ROI ≤ 1.6 → 40 元/小时'],
  [{keyType:'exact',exact:1.6,includeMin:true,includeMax:true,rate:60},'有效 ROI = 1.6 → 60 元/小时'],
  [{...range,keyType:'related',relatedField:'spend',min:10000,max:undefined},'关联 总消耗 ≥ 10000 → 40 元/小时'],
 ];
 for(const [band,summary] of cases)expect(hourlyBandSummary('roi',band)).toBe(summary);
});

it('starts saved bands collapsed with their condition and rate, and places add after every row',()=>{
 const html=renderToStaticMarkup(<HourlyBandEditor field="roi" bands={[range,{...range,min:1.6,max:undefined,rate:60}]} onChange={()=>{}}/>);
 expect(html).toContain('40 元/小时');expect(html).toContain('60 元/小时');
 expect(html).toContain('编辑档位1');expect(html).toContain('编辑档位2');expect(html).not.toContain('<input');
 expect(html.indexOf('新增档位')).toBeGreaterThan(html.indexOf('删除档位2'));
});

it('expands only the new row and keeps read-only detail compact without editing actions',()=>{
 const props={field:'roi',bands:[range,{...range,min:1.6,max:undefined,rate:60}],onChange:()=>{}};
 const editable=renderToStaticMarkup(<HourlyBandEditor {...props} initialExpandedIndex={1}/>);
 expect(editable).toContain('档位2下限');expect(editable).not.toContain('档位1下限');expect(editable).toContain('完成');
 const readOnly=renderToStaticMarkup(<HourlyBandEditor {...props} readOnly initialExpandedIndex={1}/>);
 expect(readOnly).toContain('40 元/小时');expect(readOnly).not.toContain('<input');expect(readOnly).not.toContain('<button');
});

it('offers exact matching and edits a saved rank as one numeric value without range controls',()=>{
 const band:NewRuleBand={keyType:'exact',exact:1,includeMin:true,includeMax:true,rate:80};
 const html=renderToStaticMarkup(<HourlyBandEditor field="roiRank" bands={[band]} initialExpandedIndex={0} onChange={()=>{}}/>);
 expect(html).toContain('value="exact" selected');expect(html).toContain('精确数值');
 expect(html).toContain('档位1精确数值');expect(html).not.toContain('档位1下限');expect(html).not.toContain('档位1上限');expect(html).not.toContain('档位1范围边界');
 expect(html).toContain('有效 ROI 排名 = 1 → 80 元/小时');
 expect(band.keyType).toBe('exact');
});
