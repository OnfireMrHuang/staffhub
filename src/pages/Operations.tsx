import { useHub } from '../store';
import { Badge } from '../components';
import AdvertisingProducts from './AdvertisingProducts';
import LiveProjects from './LiveProjects';
import LiveInput from './LiveInput';
import LiveDatasets from './LiveDatasets';
import RoomReports from './RoomReports';
import { normalizeOperationSection, operationSections } from '../operations-navigation';
import '../live-operations.css';
export default function Operations(){
 const s=useHub(),section=normalizeOperationSection(s.opsTab),current=operationSections.find(item=>item.id===section)!;
 return <div className="live-operations">{(section==='products'||section==='rooms')&&<div className="page-heading"><div><span className="eyebrow">OPERATIONS WORKSPACE</span><h1>{current.label}<span className="title-dot"/></h1><p>{current.description}</p></div><div className="operations-heading-tools">{!['products','rooms'].includes(section)&&<label className="operations-month-filter">运营数据月份<input aria-label="运营数据月份" type="month" value={s.month} onChange={e=>{if(e.target.value)s.setMonth(e.target.value)}}/></label>}<Badge tone="amber">模拟演示数据</Badge></div></div>}{section==='products'?<AdvertisingProducts/>:section==='rooms'?<LiveProjects/>:section==='raw'?<LiveInput/>:section==='hourly'||section==='daily'?<RoomReports key={section} period={section}/>:<LiveDatasets/>}</div>;
}
