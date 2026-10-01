import React from 'react';
import {ActivityIndicator,Image,Linking,Platform,Text,View} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {File as NativeFile} from 'expo-file-system';
import {Button,Card,ErrorNotice,color,styles} from './ui';
import {useSession} from '../services/session';
import {useAction,useLoad} from '../services/use-load';

export interface CreatorCardData {
  id:string;name:string;status:string;languages:string[];disciplines:Record<string,string>;bio:string;
  gear:{type:string;model:string}[];portfolioUrls:string[];photo:string|null;verificationCode:string;
  completedJobs:number;rating:number|null;ratingCount:number;demo:boolean;roleId?:string;discipline?:string;tier?:string;
}
interface Performance {profile:CreatorCardData;statistics:{accepted_offers:number;decided_offers:number;cancellations_90_days:number;approved_files:number;reviewed_files:number;review:string}}
const languages:Record<string,string>={ta:'தமிழ்',en:'English',hi:'हिन्दी'};
function IdentityCard({profile:p}:{profile:CreatorCardData}){
  const {user}=useSession(),ta=user?.language==='ta';
  return <Card>
    <View style={styles.row}>
      {p.photo?<Image accessibilityLabel={`${p.name} profile photo`} source={{uri:p.photo}} style={{height:80,width:80,borderRadius:40}}/>:<View style={{height:80,width:80,borderRadius:40,backgroundColor:color.paper,alignItems:'center',justifyContent:'center'}}><Text style={styles.title}>{p.name.charAt(0)}</Text></View>}
      <View style={{flex:1,gap:6}}><Text style={styles.section}>{p.name}</Text><Text style={styles.subtitle}>{p.tier?`${p.tier} · ${p.discipline}`:Object.entries(p.disciplines).map(([d,t])=>`${t} ${d}`).join(' · ')}</Text><Text style={styles.label}>{p.languages.map(l=>languages[l]??l).join(' · ')}</Text></View>
    </View>
    <Text style={styles.body}>{p.completedJobs} {ta?'நிறைவடைந்த படப்பிடிப்புகள்':'completed shoots'} · {p.rating===null?(ta?'மதிப்பீடுகள் இன்னும் இல்லை':'No ratings yet'):`${p.rating.toFixed(1)} / 5 (${p.ratingCount})`}</Text>
    <Text style={styles.label}>{ta?'சமீபத்திய 20 மதிப்பீடுகளின் சராசரி':'Average of the latest 20 creator ratings'}</Text>
    {!!p.bio&&<Text style={styles.body}>{p.bio}</Text>}
    <Text style={styles.label}>{ta?'படைப்பாளர் அடையாளக் குறியீடு':'Creator ID code'}</Text><Text selectable style={[styles.section,{letterSpacing:2}]}>{p.verificationCode}</Text>
    <Text style={styles.subtitle}>{p.demo?(ta?'சோதனை அடையாள அட்டை · உண்மையான அடையாளச் சரிபார்ப்பு செய்யப்படவில்லை.':'Demo identity card · identity checks are simulated.'):(ta?'வருகையின் போது படைப்பாளரின் செயலியில் உள்ள குறியீட்டுடன் ஒப்பிடவும்.':'Compare this code with the creator’s app at arrival.')}</Text>
    {p.gear.length>0&&<Text style={styles.body}>{ta?'கருவிகள்':'Gear'}: {p.gear.map(g=>g.model).join(' · ')}</Text>}
    {p.portfolioUrls.map((url,i)=><Button key={`${url}-${i}`} title={`${ta?'படைப்புகளைப் பார்க்க':'View portfolio'} ${i+1}`} secondary onPress={()=>void Linking.openURL(url)}/>)}
  </Card>;
}
export function AssignedCreators({sessionId}:{sessionId:string}){
  const {user}=useSession(),load=useLoad<CreatorCardData[]>(`/sessions/${sessionId}/creators`);
  return <View style={{gap:12}}><Text style={styles.section}>{user?.language==='ta'?'உங்கள் படைப்பாளர்கள்':'Your creators'}</Text><ErrorNotice message={load.error}/>{load.loading&&<ActivityIndicator/>}{load.data?.map(p=><IdentityCard key={p.roleId} profile={p}/>)}{!load.loading&&!load.error&&!load.data?.length&&<Text style={styles.subtitle}>{user?.language==='ta'?'படைப்பாளர் ஒதுக்கப்பட்டதும் விவரங்கள் இங்கே தோன்றும்.':'Profiles appear here once your creators are assigned.'}</Text>}</View>;
}
export function CreatorPerformance(){
  const {api,user}=useSession(),ta=user?.language==='ta',load=useLoad<Performance>('/creator/performance'),a=useAction(),s=load.data?.statistics;
  const photo=()=>a.run(async()=>{const result=await DocumentPicker.getDocumentAsync({type:['image/jpeg','image/png','image/webp'],copyToCacheDirectory:true,base64:false});if(result.canceled)return;const asset=result.assets[0]!;if((asset.size??0)>4*1024**2)throw new Error(ta?'4 MB-க்கும் குறைவான படத்தைத் தேர்ந்தெடுக்கவும்.':'Choose a photo smaller than 4 MB.');const bytes=new Uint8Array(Platform.OS==='web'&&asset.file?await asset.file.arrayBuffer():await new NativeFile(asset.uri).arrayBuffer());if(bytes.length>4*1024**2)throw new Error('Choose a photo smaller than 4 MB.');await api('/creator/photo',bytes,'PUT');await load.refresh();a.setSuccess(ta?'சுயவிவரப் புகைப்படம் சேமிக்கப்பட்டது.':'Your profile photo has been saved.');});
  return <View style={{gap:16}}><Text style={styles.section}>{ta?'உங்கள் படைப்பாளர் அட்டை':'Your creator card'}</Text><ErrorNotice message={load.error??a.error}/>{load.loading&&<ActivityIndicator/>}{load.data&&<IdentityCard profile={load.data.profile}/>}<Button title={ta?'சுயவிவரப் புகைப்படத்தைத் தேர்வு செய்க':'Choose profile photo'} secondary busy={a.busy} onPress={()=>void photo()}/>{a.success&&<Text style={styles.success}>{a.success}</Text>}{s&&<Card><Text style={styles.section}>{ta?'உங்கள் செயல்திறன்':'Your performance'}</Text><Text style={styles.body}>{ta?'ஏற்றுக்கொண்ட வாய்ப்புகள்':'Offers accepted'}: {s.accepted_offers} / {s.decided_offers}</Text><Text style={styles.body}>{ta?'தரப் பரிசோதனையில் ஒப்புதல் பெற்ற கோப்புகள்':'Files approved in quality review'}: {s.approved_files} / {s.reviewed_files}</Text><Text style={styles.body}>{ta?'கடந்த 90 நாட்களில் ரத்துகள்':'Cancellations in the last 90 days'}: {s.cancellations_90_days}</Text>{s.review.endsWith('_review')&&<Text style={styles.subtitle}>{ta?'உங்கள் சமீபத்திய கருத்துகளைச் செயல்பாட்டுக் குழு பரிசீலிக்க வேண்டும்.':'Your recent feedback needs an operations review.'}</Text>}<Text style={styles.subtitle}>{ta?'கணக்கிலுள்ள உண்மையான பதிவுகளிலிருந்து இவை கணக்கிடப்படுகின்றன.':'These figures are calculated from your recorded work.'}</Text></Card>}<Button title={ta?'செயல்திறனைப் புதுப்பி':'Refresh performance'} secondary onPress={()=>void load.refresh()}/></View>;
}
