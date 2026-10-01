import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Switch,Text,View} from 'react-native';
import type {MatchingPreferences} from '@kamraw/domain';
import {formatMoney} from '@kamraw/domain';
import {Button,Card,Chips,ErrorNotice,styles} from './ui';
import {useSession} from '../services/session';
import {useAction,useLoad} from '../services/use-load';

const languageLabels={any:'No language preference',ta:'தமிழ்',en:'English',hi:'हिन्दी'};
export function BookingPreferences({value,onChange}:{value:MatchingPreferences;onChange:(value:MatchingPreferences)=>void}){
 const {user}=useSession(),ta=user?.language==='ta';
 return <Card><Text style={styles.section}>{ta?'படைப்பாளர் விருப்பங்கள்':'Creator preferences'}</Text>
  <Text style={styles.subtitle}>{ta?'முடிந்தவரை உங்கள் விருப்பங்களை நிறைவேற்றுவோம். முடியாவிட்டால் பயணத்திற்கு முன் தெரிவிப்போம்; கட்டணமின்றி ரத்து செய்யலாம்.':'We match your preferences when possible. If they cannot be met, we tell you before travel and you can cancel without a fee.'}</Text>
  <Text style={styles.label}>{ta?'விரும்பும் மொழி':'Preferred language'}</Text>
  <Chips values={['any','ta','en','hi'] as const} value={value.language??'any'} labels={{...languageLabels,any:ta?'மொழி விருப்பம் இல்லை':languageLabels.any}} onChange={l=>onChange({...value,language:l==='any'?undefined:l})}/>
  <View style={styles.row}><Text style={[styles.body,{flex:1}]}>{ta?'பெண் படைப்பாளர் விருப்பம்':'Female creator preference'}</Text><Switch accessibilityLabel={ta?'பெண் படைப்பாளர் விருப்பம்':'Female creator preference'} value={value.femaleCreator} onValueChange={femaleCreator=>onChange({...value,femaleCreator})}/></View>
 </Card>;
}
interface Review {reviewId:string;roleId:string;name:string;discipline:string;tier:string;unmet:('language'|'femaleCreator')[];acceptedAt:string|null}
interface PreferenceDetail {status?:string;customer:boolean;preferences:MatchingPreferences;roles:Review[];canCancelFree:boolean}
export function PreferenceReview({sessionId,onUpdated,onPendingChange}:{sessionId:string;onUpdated?:()=>Promise<void>;onPendingChange?:(pending:boolean)=>void}){
 const {api,user}=useSession(),ta=user?.language==='ta',load=useLoad<PreferenceDetail>(`/sessions/${sessionId}/preferences`),action=useAction(),[refund,setRefund]=useState<{refundPaise:number}|null>(null);
 const pending=load.data?.roles.filter(r=>r.unmet.length&&!r.acceptedAt)??[],needsReview=pending.length>0;
 useEffect(()=>{const timer=setInterval(()=>void load.refresh(),30000);return()=>clearInterval(timer);},[load.refresh]);
 useEffect(()=>{onPendingChange?.(needsReview);},[needsReview,onPendingChange]);
 const requested=load.data?.preferences;
 if(load.data?.status==='cancelled'||load.data?.status==='refunded'||!load.error&&!requested?.language&&!requested?.femaleCreator)return null;
 const refresh=async()=>{setRefund(null);await load.refresh();await onUpdated?.();};
 return <Card><Text style={styles.section}>{load.data?.customer?(ta?'உங்கள் படைப்பாளர் விருப்பங்கள்':'Your creator preferences'):(ta?'வாடிக்கையாளர் விருப்பங்கள்':'Customer preferences')}</Text><ErrorNotice message={load.error??action.error}/>{load.loading&&<ActivityIndicator/>}
  {requested&&<Text style={styles.body}>{[requested.language&&languageLabels[requested.language],requested.femaleCreator&&(ta?'பெண் படைப்பாளர்':'Female creator')].filter(Boolean).join(' · ')}</Text>}
  {load.data?.roles.map(r=><View key={r.reviewId} style={{gap:6}}><Text style={styles.label}>{r.name} · {r.tier} {r.discipline}</Text><Text style={styles.subtitle}>{!r.unmet.length?(ta?'விருப்பங்கள் நிறைவேறின':'Preferences met'):r.unmet.map(p=>p==='language'?(ta?'விரும்பும் மொழி கிடைக்கவில்லை':'Preferred language unavailable'):(ta?'பெண் படைப்பாளர் விருப்பத்தை நிறைவேற்ற முடியவில்லை':'Female creator preference could not be met')).join(' · ')}</Text>{r.unmet.length>0&&r.acceptedAt&&<Text style={styles.label}>{load.data?.customer?(ta?'இந்த ஒதுக்கீட்டை ஏற்றுக்கொண்டீர்கள்':'You accepted this assignment'):(ta?'வாடிக்கையாளர் இந்த ஒதுக்கீட்டை ஏற்றுக்கொண்டார்':'The customer accepted this assignment')}</Text>}</View>)}
  {!load.loading&&!load.data?.roles.length&&<Text style={styles.subtitle}>{ta?'ஒதுக்கீட்டிற்குப் பிறகு விருப்பங்கள் சரிபார்க்கப்படும்.':'Preferences are checked when a creator is assigned.'}</Text>}
  {needsReview&&<Text style={styles.body}>{load.data?.customer?(ta?'சில விருப்பங்களை நிறைவேற்ற முடியவில்லை. இந்தப் படைப்பாளர்களுடன் தொடரலாம் அல்லது கட்டணமின்றி ரத்து செய்யலாம். நீங்கள் முடிவெடுக்கும் வரை பயணம் தொடங்காது.':'Some preferences could not be met. Continue with these creators or cancel without a fee. Travel waits for your decision.'):(ta?'பயணத்தைத் தொடங்கும் முன் வாடிக்கையாளர் விருப்பங்களைப் பரிசீலிக்க வேண்டும்.':'Wait for the customer to review the unmatched preferences before starting the trip.')}</Text>}
  {needsReview&&load.data?.customer&&load.data.canCancelFree&&<>
   <Button title={ta?'இந்தப் படைப்பாளர்களுடன் தொடர்க':'Continue with these creators'} busy={action.busy} onPress={()=>void action.run(async()=>{await api(`/sessions/${sessionId}/preferences/accept`,{reviewIds:pending.map(r=>r.reviewId)});await refresh();})}/>
   <Text style={styles.label}>{ta?'ஏற்றுக்கொண்ட பிறகு வழக்கமான ரத்து விதிகள் பொருந்தும்.':'After accepting, standard cancellation rules apply.'}</Text>
   <Button title={ta?'கட்டணமில்லா ரத்தைக் காண்க':'Review fee-free cancellation'} secondary busy={action.busy} onPress={()=>void action.run(async()=>{const fee=await api<{feePaise:number;refundPaise:number}>(`/sessions/${sessionId}/cancellation`);if(fee.feePaise!==0){await refresh();throw new Error(ta?'நிலை மாறியுள்ளது. புதுப்பிக்கப்பட்ட ரத்து விவரங்களைப் பார்க்கவும்.':'The decision changed. Review the updated cancellation details.');}setRefund(fee);})}/>
   {refund&&<><Text style={styles.body}>{ta?'திரும்பப் பெறும் தொகை':'Refund'} {formatMoney(refund.refundPaise)} · {ta?'கட்டணம்':'Fee'} ₹0</Text><Button title={ta?'ரத்து செய்து பணத்தைத் திரும்பப் பெறுக':'Confirm cancellation and refund'} busy={action.busy} onPress={()=>void action.run(async()=>{await api(`/sessions/${sessionId}/cancel`,{expectedFeePaise:0});await refresh();})}/></>}
  </>}
 </Card>;
}

export function CreatorMatchingProfile(){
 const {api,user}=useSession(),ta=user?.language==='ta',load=useLoad<{languages:string[];gender:string|null}>('/creator/matching-profile'),action=useAction();
 const [languages,setLanguages]=useState<string[]>([]),[gender,setGender]=useState('undisclosed');
 useEffect(()=>{if(load.data){setLanguages(load.data.languages);setGender(load.data.gender??'undisclosed');}},[load.data]);
 return <Card><Text style={styles.section}>{ta?'பொருத்தத்திற்கான விவரங்கள்':'Matching details'}</Text><Text style={styles.subtitle}>{ta?'பாலினம் விருப்பத் தகவல்; பொருத்தத்திற்கு மட்டுமே பயன்படுத்தப்படும். மாற்றங்கள் புதிய ஒதுக்கீடுகளுக்குப் பொருந்தும்.':'Gender is optional and used only for matching. Changes apply to new assignments.'}</Text><ErrorNotice message={load.error??action.error}/>
  {(['ta','en','hi'] as const).map(l=><View key={l} style={styles.row}><Text style={styles.body}>{languageLabels[l]}</Text><Switch accessibilityLabel={languageLabels[l]} value={languages.includes(l)} onValueChange={v=>setLanguages(v?[...languages,l]:languages.filter(x=>x!==l))}/></View>)}
  <Chips values={['undisclosed','female','male','non_binary'] as const} value={gender} labels={ta?{undisclosed:'தெரிவிக்க விரும்பவில்லை',female:'பெண்',male:'ஆண்',non_binary:'இருமையற்றவர்'}:{undisclosed:'Prefer not to say',female:'Female',male:'Male',non_binary:'Non-binary'}} onChange={setGender}/>
  <Button title={ta?'பொருத்த விவரங்களைச் சேமிக்க':'Save matching details'} disabled={load.loading||!load.data||!languages.length} busy={action.busy} onPress={()=>void action.run(async()=>{await api('/creator/matching-profile',{languages,gender:gender==='undisclosed'?null:gender},'PUT');await load.refresh();action.setSuccess(ta?'விவரங்கள் சேமிக்கப்பட்டன.':'Matching details saved.');})}/>{action.success&&<Text style={styles.success}>{action.success}</Text>}
 </Card>;
}
