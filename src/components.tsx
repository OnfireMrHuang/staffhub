import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowUpRight, Check, ChevronRight, Download, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useHub } from './store';
import type { Page } from './store';
import * as XLSX from 'xlsx';

export const number = (v:number, digits=0) => v.toLocaleString('zh-CN',{maximumFractionDigits:digits,minimumFractionDigits:digits});
export const yuan = (v:number) => `¥${number(v,2)}`;
export function Badge({children,tone='green'}:{children:ReactNode;tone?:string}){return <span className={`badge ${tone}`}><span/>{children}</span>}
export function Avatar({name,size='normal'}:{name:string;size?:string}){return <span className={`avatar ${size} color-${name.charCodeAt(0)%5}`}>{name.slice(-2)}</span>}
export function Person({name,id}:{name:string;id?:string}){return <span className="person"><Avatar name={name}/><span><strong>{name}</strong>{id&&<small>{id}</small>}</span></span>}
export function Button({children,onClick,variant='',disabled=false,className='',type='button'}:{children:ReactNode;onClick?:()=>void;variant?:string;disabled?:boolean;className?:string;type?:'button'|'submit'}){return <button type={type} className={`button ${variant} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>}
export function Panel({children,className=''}:{children:ReactNode;className?:string}){return <section className={`panel ${className}`}>{children}</section>}
export function Modal({open,onOpenChange,title,description,children,wide=false}:{open:boolean;onOpenChange:(v:boolean)=>void;title:string;description?:string;children:ReactNode;wide?:boolean}){return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="overlay"/><Dialog.Content className={`dialog ${wide?'wide':''}`}><div className="dialog-head"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description||'查看并操作演示中的业务数据。'}</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="关闭"><X size={20}/></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>}
export function TabBar({value,onChange,items}:{value:string;onChange:(v:string)=>void;items:{id:string;label:string;icon?:ReactNode}[]}){return <Tabs.Root value={value} onValueChange={onChange}><Tabs.List className="tabs" aria-label="业务分区">{items.map(i=><Tabs.Trigger value={i.id} key={i.id}>{i.icon}{i.label}</Tabs.Trigger>)}</Tabs.List></Tabs.Root>}
export function SearchBox({value,onChange,placeholder='搜索员工姓名 / 编号'}:{value:string;onChange:(v:string)=>void;placeholder?:string}){return <label className="search"><Search size={16}/><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}/></label>}
export function Empty({title,description,children}:{title:string;description:string;children?:ReactNode}){return <div className="empty"><span className="empty-icon"><Check size={24}/></span><h3>{title}</h3><p>{description}</p>{children}</div>}
export function SectionTitle({title,description,children}:{title:string;description?:string;children?:ReactNode}){return <div className="section-title"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div><div className="actions">{children}</div></div>}
export function Stat({label,value,foot,icon,accent=false}:{label:string;value:ReactNode;foot:ReactNode;icon:ReactNode;accent?:boolean}){return <div className={`stat ${accent?'accent':''}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}</strong><small>{foot}</small></div>}
export function go(page:Page,tab?:string){useHub.getState().navigate(page,tab)}
export function attempt(action:()=>void,success?:string){try{action();if(success)useHub.getState().notify(success)}catch(e){useHub.getState().notify(`操作未完成：${e instanceof Error?e.message:'请核对数据'}`)}}
export function exportSheet(name:string,rows:Record<string,unknown>[],sheet='数据') {const book=XLSX.utils.book_new(); const table=XLSX.utils.json_to_sheet(rows); table['!cols']=Object.keys(rows[0]||{}).map(()=>({wch:20})); XLSX.utils.book_append_sheet(book,table,sheet); XLSX.writeFile(book,`${name}.xlsx`);}
export function ExportButton({onClick}:{onClick:()=>void}){return <Button onClick={onClick}><Download size={15}/>导出表格</Button>}
export function InlineLink({children,onClick}:{children:ReactNode;onClick:()=>void}){return <button className="text-button" onClick={onClick}>{children}<ChevronRight size={14}/></button>}
export function SourceLink({title,url}:{title:string;url:string}){return <a className="source-link" href={url} target="_blank" rel="noreferrer">{title}<ArrowUpRight size={15}/></a>}
