import { FileSpreadsheet, Package, Layers3, Video } from 'lucide-react';
import { useHub } from '../store';
import { Badge, TabBar } from '../components';
import AdvertisingProducts from './AdvertisingProducts';
import LiveProjects from './LiveProjects';
import LiveInput from './LiveInput';
import LiveDatasets from './LiveDatasets';
import '../live-operations.css';
export default function Operations(){
 const s=useHub(),tab=s.opsTab==='projects'?'rooms':s.opsTab;
 return <div className="live-operations"><div className="page-heading"><div><span className="eyebrow">OPERATIONS WORKSPACE</span><h1>运营工作台<span className="title-dot"/></h1><p>投放产品关联直播间，直播记录与小时数据形成固定统计表和月度薪酬依据。</p></div><div className="operations-heading-tools">{(tab==='input'||tab==='datasets')&&<label className="operations-month-filter">运营数据月份<input aria-label="运营数据月份" type="month" value={s.month} onChange={e=>{if(e.target.value)s.setMonth(e.target.value)}}/></label>}<Badge tone="amber">模拟小时数据</Badge></div></div><TabBar value={tab} onChange={v=>s.navigate('operations',v)} items={[{id:'products',label:'投放产品',icon:<Package size={17}/>},{id:'rooms',label:'直播间',icon:<Video size={17}/>},{id:'input',label:'数据录入',icon:<FileSpreadsheet size={17}/>},{id:'datasets',label:'运营数据集',icon:<Layers3 size={17}/>} ]}/>{tab==='products'?<AdvertisingProducts/>:tab==='rooms'?<LiveProjects/>:tab==='input'?<LiveInput/>:<LiveDatasets/>}</div>;
}
