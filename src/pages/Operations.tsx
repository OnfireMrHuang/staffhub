import { FileSpreadsheet, FolderKanban, Layers3 } from 'lucide-react';
import { useHub } from '../store';
import { Badge, TabBar } from '../components';
import LiveProjects from './LiveProjects';
import LiveInput from './LiveInput';
import LiveDatasets from './LiveDatasets';
import '../live-operations.css';
export default function Operations(){const s=useHub();return <div className="live-operations"><div className="page-heading"><div><span className="eyebrow">OPERATIONS WORKSPACE</span><h1>运营工作台<span className="title-dot"/></h1><p>直播记录关联平台小时数据，形成固定统计表与月度薪酬依据。</p></div><Badge tone="amber">模拟小时数据 · 2026-10</Badge></div><TabBar value={s.opsTab} onChange={v=>s.navigate('operations',v)} items={[{id:'projects',label:'投放项目',icon:<FolderKanban size={17}/>},{id:'input',label:'数据录入',icon:<FileSpreadsheet size={17}/>},{id:'datasets',label:'运营数据集',icon:<Layers3 size={17}/>} ]}/>{s.opsTab==='projects'?<LiveProjects/>:s.opsTab==='input'?<LiveInput/>:<LiveDatasets/>}</div>}
