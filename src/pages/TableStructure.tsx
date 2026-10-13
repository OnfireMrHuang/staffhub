import { Badge } from '../components';

interface FieldDescription {name:string;key:string;type:string;note:string}
export type StructureField = FieldDescription & (
 {kind:'维度';metricType?:never} |
 {kind:'指标';metricType:'时长指标'|'常规指标'}
);
export default function TableStructure({fields}:{fields:StructureField[]}){
 return <div className="table-scroll"><table className="live-schema-table"><thead><tr><th>字段</th><th>演示字段标识</th><th>字段分类</th><th>类型 / 单位</th><th>说明</th></tr></thead><tbody>{fields.map(f=><tr key={f.key}><td><strong>{f.name}</strong></td><td><code>{f.key}</code></td><td><div className="schema-field-kind"><Badge tone={f.kind==='维度'?'gray':'green'}>{f.kind}</Badge>{f.kind==='指标'&&<span className={f.metricType==='时长指标'?'schema-duration':'muted'}>{f.metricType}</span>}</div></td><td>{f.type}</td><td>{f.note}</td></tr>)}</tbody></table></div>;
}
