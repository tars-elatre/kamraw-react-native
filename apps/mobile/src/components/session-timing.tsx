import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {formatMoney} from '@kamraw/domain';
import {Button,Card,ErrorNotice,Field,styles} from './ui';
import {useSession} from '../services/session';
import {useAction,useLoad} from '../services/use-load';
interface Timing {serverTime:string;customer:boolean;venueAllowsOverrun:boolean;bookedEnd:string;lateCreditPaise:number;roles:{role_id:string;name:string;status:string;checked_in_at:string|null;actual_started_at:string|null;actual_completed_at:string|null;service_end_at:string;late:boolean;overrun_conflict:boolean;request_id:string|null;request_status:string|null;requested_at:string|null;available_after:string|null}[]}
const time=(s:string)=>new Date(s).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'});
export function SessionTiming({sessionId,roleId,status,location,onUpdated}:{sessionId:string;roleId?:string;status?:string;location?:()=>Promise<{lat:number;lng:number;accuracy:number}>;onUpdated?:()=>Promise<void>}){
 const {api,user}=useSession(),ta=user?.language==='ta',load=useLoad<Timing>(`/sessions/${sessionId}/timing`),a=useAction(),[reason,setReason]=useState(''),[clock,setClock]=useState(Date.now()),anchor=useRef({server:Date.now(),local:Date.now()});
 useEffect(()=>{if(load.data){const local=Date.now();anchor.current={server:Date.parse(load.data.serverTime),local};setClock(local);}},[load.data]);
 const update=useCallback(async()=>{await load.refresh();await onUpdated?.();},[load.refresh,onUpdated]);
 const rows=load.data?.roles.filter(r=>!roleId||r.role_id===roleId)??[],active=rows.some(r=>['arrived','in_session'].includes(r.status));
 const polling=['confirmed','assigned','reconfirmed','en_route','arrived','in_session'].includes(status??rows[0]?.status??'');
 useEffect(()=>{if(!polling)return;const id=setInterval(()=>void update().catch(()=>{}),30000);return ()=>clearInterval(id);},[polling,update]);
 useEffect(()=>{if(!active)return;const id=setInterval(()=>setClock(Date.now()),1000);return ()=>clearInterval(id);},[active]);
 const serverNow=anchor.current.server+clock-anchor.current.local;
 const remaining=(end:string)=>{const seconds=Math.max(0,Math.ceil((Date.parse(end)-serverNow)/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
 return <Card><Text style={styles.section}>{ta?'படப்பிடிப்பு நேரம்':'Shoot timing'}</Text><ErrorNotice message={load.error??a.error}/>{load.loading&&!load.data&&<ActivityIndicator/>}{load.data?.lateCreditPaise? <Text style={styles.success}>{ta?'தாமத வருகைக்கான கிரெடிட்':'Late-arrival credit'} · {formatMoney(load.data.lateCreditPaise)}</Text>:null}
  {rows.map(r=><View key={r.role_id} style={{gap:10}}><Text style={styles.body}>{r.name.split(' · ')[0]}</Text><Text style={styles.subtitle}>{r.checked_in_at?`${ta?'வருகை':'Arrived'} ${time(r.checked_in_at)} · `:''}{r.actual_completed_at?`${ta?'முடிந்தது':'Completed'} ${time(r.actual_completed_at)}`:`${ta?'ஒப்புக்கொண்ட முடிவு நேரம்':'Agreed end'} ${time(r.service_end_at)}`}</Text>
   {r.status==='in_session'&&<Text style={styles.section}>{remaining(r.service_end_at)} · {ta?'மீதமுள்ள நேரம்':'time remaining'}</Text>}
   {r.late&&<Text style={styles.subtitle}>{ta?'வருகையிலிருந்து முழு நேரம், இடம் அனுமதித்தால். தாமதம் பதிவு செய்யப்பட்டது.':'Full time runs from arrival where the venue allows. The late arrival is recorded.'}</Text>}
   {r.overrun_conflict&&<Text style={styles.subtitle}>{ta?'மற்றொரு பணியின் நேரத்தைச் செயல்பாட்டுக் குழு சரிசெய்ய வேண்டும்.':'Operations must coordinate another commitment affected by this delay.'}</Text>}
   {r.request_status==='pending'&&<Text style={styles.body}>{ta?'படைப்பாளர் படப்பிடிப்பை முடித்துள்ளார். பிரச்சனை இல்லாவிட்டால் தானாக நிறைவடையும் நேரம்':'Your creator has ended the shoot. Unless disputed, completion will be confirmed at'} {time(r.available_after!)}.</Text>}
   {r.request_status==='disputed'&&<Text style={styles.error}>{ta?'தானியங்கி நிறைவு நிறுத்தப்பட்டது. செயல்பாட்டுக் குழு பரிசீலிக்கும்.':'Automatic completion is paused for operations review.'}</Text>}
   {load.data?.customer&&r.request_id&&['pending','disputed'].includes(r.request_status??'')&&<>
    <Button title={ta?'படப்பிடிப்பு முடிந்தது என்பதை உறுதிசெய்':'Confirm the shoot is complete'} busy={a.busy} onPress={()=>void a.run(async()=>{await api(`/completion-requests/${r.request_id}/decision`,{action:'confirm'});await update();})}/>
    {r.request_status==='pending'&&<><Field label={ta?'நிறைவில் உள்ள பிரச்சனை':'Issue with completion'} value={reason} onChangeText={setReason} multiline/><Button title={ta?'பரிசீலனைக்குக் கோரு':'Ask operations to review'} secondary busy={a.busy} disabled={reason.trim().length<5} onPress={()=>void a.run(async()=>{await api(`/completion-requests/${r.request_id}/decision`,{action:'dispute',reason});await update();})}/></>}
   </>}
   {!load.data?.customer&&r.role_id===roleId&&r.status==='in_session'&&!['pending','disputed'].includes(r.request_status??'')&&location&&<Button title={ta?'வாடிக்கையாளர் இல்லை · படப்பிடிப்பை முடி':'Customer unavailable · End shoot'} secondary busy={a.busy} disabled={Date.parse(r.service_end_at)>serverNow} onPress={()=>void a.run(async()=>{await api(`/creator/roles/${roleId}/completion-request`,{clientId:Crypto.randomUUID(),location:await location()});await update();a.setSuccess(ta?'இடம் பதிவு செய்யப்பட்டது. வாடிக்கையாளருக்கு ஒரு மணி நேரம் உள்ளது.':'Checkout location saved. The customer has one hour to confirm or raise an issue.');})}/>}
  </View>)}
  {load.data?.customer&&active&&!rows.some(r=>['pending','disputed'].includes(r.request_status??''))&&rows.some(r=>r.late||Date.parse(r.service_end_at)>Date.parse(load.data!.bookedEnd)||!load.data!.venueAllowsOverrun)&&<><Text style={styles.subtitle}>{ta?'இடம் தாமதமான முடிவு நேரத்தை அனுமதிக்கிறதா?':'Can the venue accommodate the later finish?'}</Text><Button title={load.data.venueAllowsOverrun?(ta?'முதலில் முன்பதிவு செய்த நேரத்தில் முடிக்கவும்':'Venue requires the original end time'):(ta?'வருகையிலிருந்து முழு நேரத்தை அனுமதி':'Allow the full duration from arrival')} secondary busy={a.busy} onPress={()=>void a.run(async()=>{await api(`/sessions/${sessionId}/venue-timing`,{allowOverrun:!load.data!.venueAllowsOverrun},'PUT');await update();})}/></>}
  {a.success&&<Text style={styles.success}>{a.success}</Text>}<Button title={ta?'நேரத்தைப் புதுப்பி':'Refresh shoot timing'} secondary onPress={()=>void a.run(update)}/>
 </Card>;
}
