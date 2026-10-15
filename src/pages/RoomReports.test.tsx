import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RoomReports from './RoomReports';
import Operations from './Operations';
import LiveInput from './LiveInput';
import { useHub } from '../store';

it('hourly and daily surfaces expose their room, measured time grain and fixed schema',()=>{
 const s=useHub.getInitialState(),room=s.rooms[0],hours=s.reportHours.filter(h=>h.roomId===room.id),days=s.reportDays.filter(d=>d.roomId===room.id);
 const hourly=renderToStaticMarkup(<RoomReports period="hourly"/>),daily=renderToStaticMarkup(<RoomReports period="daily"/>);
 expect(hourly).toContain('aria-label="报表直播间"');expect(hourly).toContain(`${room.name} · 时报`);expect(hourly).toContain('查看表结构');expect(hourly).toContain('导出时报');expect(hourly).toContain('刷新统计');expect(hourly).toContain('aria-label="运营数据月份"');
 expect(hourly).toContain(`<td>${hours[0].start}</td><td>${hours[0].end}</td>`);expect(hourly.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g)).toHaveLength(hours.length);
 expect(daily).toContain(`${room.name} · 日报`);expect(daily).toContain('直播时长');expect(daily).toContain(days[0].date);expect(daily.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g)).toHaveLength(days.length);
});
it('monthly operations renders one unified table with every employee-room row and its edit action',()=>{
 const s=useHub.getInitialState(),html=renderToStaticMarkup(<Operations/>);
 expect(html.match(/<table(?:\s|>)/g)).toHaveLength(1);expect(html).toContain('员工月度汇总表');
 for(const row of s.monthlyRows){
  expect(html).toContain(`aria-label="编辑月度汇总 ${row.employeeName} ${row.roomName} ${row.month}"`);
 }
 for(const room of s.rooms.filter(room=>s.monthlyRows.some(row=>row.roomId===room.id))) expect(html).toContain(room.name);
 expect(html).toContain('统计筛选部门');expect(html).toContain('统计筛选直播间');expect(html).toContain('导出月度汇总');
});
it('raw input surface retains source record identity, measured time span and entry/export actions',()=>{
 const s=useHub.getInitialState(),record=s.liveRecords[0],html=renderToStaticMarkup(<LiveInput/>);
 expect(html).toContain(`<code>${record.id}</code>`);expect(html).toContain(`<td>${record.date}</td><td>${record.start}</td><td>${record.end}</td>`);
 expect(html).toContain('role="tablist"');expect(html).toContain('role="tab"');expect(html).toContain('aria-label="运营数据月份"');expect(html).toContain('表单录入');expect(html).toContain('上传表格');expect(html).toContain('导出当前记录');expect(html).toContain('直播间基础数据');
});
