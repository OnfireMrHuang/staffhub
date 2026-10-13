import type { Project } from './domain';
import type { AdHourly, LiveRecord, RoomHourly } from './live-domain';

interface SimulatedSyncInput {
 month:string; projects:Project[]; records:LiveRecord[]; adHours:AdHourly[]; roomHours:RoomHourly[];
}
const hourText = (hour:number) => `${String(hour).padStart(2,'0')}:00`;
const businessKey = (...parts:string[]) => JSON.stringify(parts);
const money = (amount:number) => Math.round(amount*100)/100;
function fictionalNumber(key:string):number {
 let value=0;
 for(const character of key) value=(value*31+character.charCodeAt(0))>>>0;
 return value;
}
function generatedId(prefix:string,key:string,used:Set<string>):string {
 const base=`simulated-${prefix}:${encodeURIComponent(key)}`;
 let id=base,index=1;
 while(used.has(id)) id=`${base}:${index++}`;
 used.add(id);
 return id;
}
/** Local DEMO generator only. Every new amount and denominator is fictional and deterministic.
 * Dates come from the selected month's live records. This is not a platform fetch, and the
 * full 24-hour sample does not claim that a real current day has finished reporting. */
export function fillSimulatedHours(input:SimulatedSyncInput) {
 const dates=[...new Set(input.records.filter(record=>record.date.startsWith(input.month+'-')).map(record=>record.date))].sort();
 const projects=input.projects.filter(project=>project.active);
 const adHours=[...input.adHours],roomHours=[...input.roomHours];
 const adKeys=new Set(adHours.map(row=>businessKey(row.projectId,row.date,row.start)));
 const roomKeys=new Set(roomHours.map(row=>businessKey(row.projectId,row.accountId,row.date,row.start)));
 const adIds=new Set(adHours.map(row=>row.id)),roomIds=new Set(roomHours.map(row=>row.id));
 for(const date of dates) for(const project of projects) for(let hour=0;hour<24;hour++) {
  const start=hourText(hour),end=hourText(hour+1),adKey=businessKey(project.id,date,start);
  if(!adKeys.has(adKey)) {
   const sample=fictionalNumber(adKey),spend=800+sample%900,clicks=120+sample%100,conversions=10+sample%15;
   adHours.push({id:generatedId('ad',adKey,adIds),projectId:project.id,date,start,end,spend,payment:money(spend*1.7),impressions:10000+sample%5000,clicks,conversions,conversionCost:spend/conversions,conversionRate:conversions/clicks,orders:conversions});
   adKeys.add(adKey);
  }
  for(const accountId of new Set(project.liveAccountIds)) {
   const roomKey=businessKey(project.id,accountId,date,start);
   if(roomKeys.has(roomKey)) continue;
   const sample=fictionalNumber(roomKey),spend=1500+sample%1200+hour*20,roi=1.8+(sample%60)/100;
   const clicks=200+sample%150,conversions=15+sample%20;
   // These invented denominator definitions are specific to this simulator, not platform rules.
   const clickRateDenominator=5000+sample%5000,conversionRateDenominator=clicks;
   roomHours.push({id:generatedId('room',roomKey,roomIds),projectId:project.id,accountId,date,start,end,spend,revenue:money(spend*roi),clicks,clickRate:clicks/clickRateDenominator,clickRateDenominator,clickCost:spend/clicks,conversions,conversionRate:conversions/conversionRateDenominator,conversionRateDenominator,conversionCost:spend/conversions,roi:money(spend*roi)/spend,orders:conversions,viewers:1000+sample%2000,fans:5+sample%15,tips:sample%20+1});
   roomKeys.add(roomKey);
  }
 }
 return {adHours,roomHours,addedAdHours:adHours.length-input.adHours.length,addedRoomHours:roomHours.length-input.roomHours.length};
}
