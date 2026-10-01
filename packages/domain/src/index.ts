import { z } from 'zod';

export const categories = ['birthday', 'ceremony', 'engagement', 'wedding', 'reception', 'corporate', 'portrait', 'brand'] as const;
export const disciplines = ['photo', 'video'] as const;
export const roleSchema = z.object({ discipline: z.enum(disciplines), tier: z.enum(['T1','T2','T3']), count: z.number().int().min(1).max(5) }).refine(r => r.discipline === 'photo' ? r.tier !== 'T3' : r.tier !== 'T1', 'This tier is not available for the selected discipline');
export const pointSchema = z.object({ lat:z.number().min(-90).max(90), lng:z.number().min(-180).max(180) });
export const venueSchema = pointSchema.extend({address:z.string().trim().min(5).max(500),type:z.enum(['home','hall','hotel','outdoor','office']),contactName:z.string().min(2).max(80),contactPhone:z.string().regex(/^\+91[6-9]\d{9}$/),notes:z.string().max(1000).default('')});
export const sessionSchema = z.object({start:z.iso.datetime({offset:true}),hours:z.number().int().min(2).max(10),mode:z.enum(['on_demand','scheduled']),venue:venueSchema,roles:z.array(roleSchema).min(1).max(5),style:z.enum(['candid','traditional','both']),preferences:z.object({language:z.enum(['ta','en','hi']).optional(),femaleCreator:z.boolean().default(false)}),notes:z.string().max(2000).default(''),addons:z.array(z.string().max(40)).max(8).default([])});
export const bookingSchema = z.object({category:z.enum(categories),sessions:z.array(sessionSchema).min(1).max(12),termsVersion:z.string().min(1).max(30)});
export type BookingInput = z.infer<typeof bookingSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type Point = z.infer<typeof pointSchema>;
export type Discipline = typeof disciplines[number];
export type Tier = 'T1'|'T2'|'T3';
export const states = ['confirmed','assigned','reconfirmed','en_route','arrived','in_session','session_completed','media_verified','editing','preview_delivered','final_delivered','closed','cancelled','disputed','refunded'] as const;
export type Status = typeof states[number];
const transitions: Record<Status,Status[]> = {
  confirmed:['assigned','cancelled'],assigned:['reconfirmed','en_route','confirmed','cancelled'],reconfirmed:['en_route','confirmed','cancelled'],en_route:['arrived','confirmed','cancelled'],arrived:['in_session','cancelled'],in_session:['session_completed','disputed'],session_completed:['media_verified','disputed'],media_verified:['editing','disputed'],editing:['preview_delivered','disputed'],preview_delivered:['final_delivered','disputed'],final_delivered:['closed','disputed'],closed:[],cancelled:['refunded'],disputed:['refunded','editing','closed'],refunded:[]
};
export function assertTransition(from:Status,to:Status):void { if(!transitions[from].includes(to)) throw new Error(`Cannot move from ${from} to ${to}`); }
export function earliestStart(now:Date,leadMinutes=120):Date { return new Date(Math.ceil((now.getTime()+leadMinutes*60000)/900000)*900000); }
export function serviceHour(date:Date):number { const d=new Date(date.getTime()+330*60000);return d.getUTCHours()+d.getUTCMinutes()/60; }
export function earliestServiceStart(now:Date,leadMinutes=120,openHour=4,closeHour=22):Date {
  const first=earliestStart(now,leadMinutes),hour=serviceHour(first);
  if(hour>=openHour&&hour<=closeHour)return first;
  const india=new Date(first.getTime()+330*60000);
  if(hour>closeHour)india.setUTCDate(india.getUTCDate()+1);
  india.setUTCHours(Math.floor(openHour),Math.round((openHour%1)*60),0,0);
  return new Date(india.getTime()-330*60000);
}
export function validateSessionTime(session:SessionInput,now:Date,leadMinutes:number,openHour=4,closeHour=22):void {
  const start=new Date(session.start);
  if(start.getTime()<earliestStart(now,leadMinutes).getTime()) throw new Error('Start time is earlier than the available lead time');
  if(start.getTime()>now.getTime()+180*86400000) throw new Error('Bookings open up to 180 days ahead');
  if(serviceHour(start)<openHour||serviceHour(start)>closeHour) throw new Error('Start must be within the zone service hours (India time)');
}
export function distanceMetres(a:Point,b:Point):number {
  const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlng=(b.lng-a.lng)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function pointInPolygon(p:Point,polygon:Point[]):boolean {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i]!,b=polygon[j]!;
    if((a.lat>p.lat)!==(b.lat>p.lat)&&p.lng<(b.lng-a.lng)*(p.lat-a.lat)/(b.lat-a.lat)+a.lng) inside=!inside;
  }
  return inside;
}
export interface Zone {id:string;name:string;polygon:Point[];active:boolean;onDemand:boolean;leadMinutes:number;feePaise:number;openHour:number;closeHour:number}
export interface RateCard {version:number;rates:Record<string,{hourPaise:number;earningHourPaise:number}>;addons:Record<string,number>;taxBps:number;urgencyBps:number;peakBps:number;peakCapPaise:number;earlyBps:number;peakDates:string[];cancellationBps:[number,number,number,number,number];retentionDays:number}
export interface PriceLine {label:string;amountPaise:number;sessionIndex:number}
export interface Price {totalPaise:number;subtotalPaise:number;taxPaise:number;lines:PriceLine[];sessionTotals:number[];version:number}
export function quotePrice(input:BookingInput,zones:Zone[],card:RateCard,now:Date):Price {
  const lines:PriceLine[]=[],sessionTotals:number[]=[];
  input.sessions.forEach((s,index)=>{
    const zone=zones.find(z=>z.active&&pointInPolygon(s.venue,z.polygon));
    if(!zone) throw new Error('This venue is outside our active service zones');
    if(s.mode==='on_demand'&&!zone.onDemand) throw new Error('On-demand booking is not available in this zone yet');
    validateSessionTime(s,now,zone.leadMinutes,zone.openHour,zone.closeHour);
    let base=0;
    for(const r of s.roles){const rate=card.rates[`${r.discipline}:${r.tier}`];if(!rate)throw new Error('No approved rate for this service');base+=rate.hourPaise*s.hours*r.count;}
    const gap=new Date(s.start).getTime()-now.getTime();
    const date=new Date(new Date(s.start).getTime()+330*60000).toISOString().slice(0,10);
    const additions:PriceLine[]=[{label:'Coverage',amountPaise:base,sessionIndex:index},{label:'Zone fee',amountPaise:zone.feePaise,sessionIndex:index}];
    if(gap<86400000)additions.push({label:'Urgency fee',amountPaise:Math.round(base*card.urgencyBps/10000),sessionIndex:index});
    if(card.peakDates.includes(date))additions.push({label:'Peak date fee',amountPaise:Math.min(card.peakCapPaise,Math.round(base*card.peakBps/10000)),sessionIndex:index});
    if(gap>=7*86400000)additions.push({label:'Early booking saving',amountPaise:-Math.round(base*card.earlyBps/10000),sessionIndex:index});
    for(const a of new Set(s.addons)){const price=card.addons[a];if(price===undefined)throw new Error('Unknown add-on');additions.push({label:a,amountPaise:price,sessionIndex:index});}
    const sub=additions.reduce((t,l)=>t+l.amountPaise,0),tax=Math.round(sub*card.taxBps/10000);
    additions.push({label:'Tax',amountPaise:tax,sessionIndex:index});lines.push(...additions);sessionTotals.push(sub+tax);
  });
  const totalPaise=sessionTotals.reduce((a,b)=>a+b,0),taxPaise=lines.filter(x=>x.label==='Tax').reduce((a,b)=>a+b.amountPaise,0);
  if(!Number.isSafeInteger(totalPaise)||totalPaise<=0)throw new Error('Invalid rate configuration');
  return {totalPaise,taxPaise,subtotalPaise:totalPaise-taxPaise,lines,sessionTotals,version:card.version};
}
export function cancellation(total:number,start:Date,now:Date,status:Status,bands:RateCard['cancellationBps'],platformFault=false) {
  const h=(start.getTime()-now.getTime())/3600000;
  const bps=platformFault?0:['arrived','in_session'].includes(status)?bands[4]:status==='en_route'||h<2?bands[3]:h<24?bands[2]:h<=72?bands[1]:bands[0];
  const feePaise=Math.round(total*bps/10000);return {feePaise,refundPaise:total-feePaise,feeBps:bps};
}
export type MatchingPreferences = SessionInput['preferences'];
export function unmetPreferences(preferences:MatchingPreferences,creator:{languages?:string[];gender?:unknown}): ('language'|'femaleCreator')[] {
  const unmet:('language'|'femaleCreator')[]=[];
  if(preferences.language&&!creator.languages?.includes(preferences.language))unmet.push('language');
  if(preferences.femaleCreator&&creator.gender!=='female')unmet.push('femaleCreator');
  return unmet;
}
export interface Candidate {languages?:string[];gender?:unknown;id:string;disciplines:Partial<Record<Discipline,Tier>>;active:boolean;online:boolean;zoneIds:string[];rating:number;reliability:number;qc:number;recentJobs:number;acceptance:number;etaMinutes:number;nextProximity:number;blocked:boolean;available:boolean}
export function dispatchScore(c:Candidate) {return (1-Math.min(c.etaMinutes,80)/80)*.3+c.reliability*.2+(c.rating/5)*.15+c.qc*.15+(1/(1+c.recentJobs))*.1+c.acceptance*.05+c.nextProximity*.05;}
export function eligibleCandidates(candidates:Candidate[],role:{discipline:Discipline;tier:Tier},mode:SessionInput['mode'],zoneId:string,preferences:MatchingPreferences={femaleCreator:false}) {
  return candidates.filter(c=>c.active&&c.available&&!c.blocked&&(mode!=='on_demand'||c.online)&&c.zoneIds.includes(zoneId)&&c.disciplines[role.discipline]===role.tier&&c.etaMinutes<=80).sort((a,b)=>unmetPreferences(preferences,a).length-unmetPreferences(preferences,b).length||dispatchScore(b)-dispatchScore(a)||a.id.localeCompare(b.id));
}
export function safeToFormat(files:{bytes:number;checksum:string;verifiedChecksum:string|null;copies:number;status:string}[],expectedCount:number,expectedBytes:number) {
  return expectedCount>0&&files.length===expectedCount&&files.reduce((t,f)=>t+f.bytes,0)===expectedBytes&&files.every(f=>f.status==='verified'&&f.checksum===f.verifiedChecksum&&f.copies>=2);
}
export function assertBalanced(entries:{account:string;amountPaise:number}[]) {if(entries.length<2||entries.some(e=>!Number.isSafeInteger(e.amountPaise))||entries.reduce((t,e)=>t+e.amountPaise,0)!==0)throw new Error('Ledger transaction must balance');}
export const formatMoney=(paise:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2}).format(paise/100);
