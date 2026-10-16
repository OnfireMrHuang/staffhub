import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { compensationRoomOwners, type CompensationRule } from '../compensation-rules';
import type { LiveRoom } from '../operations-domain';

export default function CompensationRoomPicker({rule,rooms,rules,readOnly,onChange}:{
 rule:CompensationRule;rooms:LiveRoom[];rules:CompensationRule[];readOnly:boolean;onChange:(roomIds:string[])=>void;
}) {
 const owners=compensationRoomOwners(rules,rule.id);
 const options=[...rooms,...rule.roomIds.filter(id=>!rooms.some(room=>room.id===id)).map(id=>({id,name:id,active:false}))];
 const selected=options.filter(room=>rule.roomIds.includes(room.id));
 return <section className="compensation-room-scope">
  <h3>适用直播间</h3>
  <Dropdown.Root>
   <Dropdown.Trigger asChild><button type="button" className="compensation-room-trigger" aria-label="选择适用直播间" disabled={readOnly}>
    <span>{selected.length?selected.map(room=>room.name).join('、'):'请选择直播间（可多选）'}</span><ChevronDown size={16}/>
   </button></Dropdown.Trigger>
   <Dropdown.Portal><Dropdown.Content className="compensation-room-menu" align="start" sideOffset={6} collisionPadding={16}>
    {options.length?options.map(room=>{
     const checked=rule.roomIds.includes(room.id),owner=owners.get(room.id);
     const unavailable=!!owner||!room.active;
     return <Dropdown.CheckboxItem key={room.id} className="compensation-room-option" checked={checked} disabled={readOnly||(!checked&&unavailable)} onSelect={event=>event.preventDefault()} onCheckedChange={value=>{
      if(readOnly || (value&&unavailable))return;
      onChange(value?[...new Set([...rule.roomIds,room.id])]:rule.roomIds.filter(id=>id!==room.id));
     }}>
      <span className="compensation-room-check"><Dropdown.ItemIndicator><Check size={13}/></Dropdown.ItemIndicator></span>
      <span><strong>{room.name}</strong><small>{owner?`已被「${owner.name}」占用`:!room.active?'已停用或不存在':room.id}</small></span>
     </Dropdown.CheckboxItem>;
    }):<span className="compensation-room-empty">暂无直播间</span>}
   </Dropdown.Content></Dropdown.Portal>
  </Dropdown.Root>
 </section>;
}
