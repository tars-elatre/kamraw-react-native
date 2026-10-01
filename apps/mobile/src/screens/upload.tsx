import React,{useState} from 'react';
import {Platform,Text,View} from 'react-native';
import type {StaticScreenProps} from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import {File as NativeFile} from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Button,Card,Chips,ErrorNotice,Page,styles} from '../components/ui';
import {useSession} from '../services/session';
import {useAction} from '../services/use-load';
interface Upload {id:string;assets:{id:string;filename:string;bytes:string;received_bytes:string;status:string}[]}
interface Receipt {message:string;demoVerified:boolean;safeToFormat:boolean;files:number;bytes:number}
export function UploadScreen({route}:StaticScreenProps<{sessionId:string}>){
 const {api,user}=useSession(),a=useAction(),[files,setFiles]=useState<DocumentPicker.DocumentPickerAsset[]>([]),[kind,setKind]=useState<'original'|'edited'>('original'),[progress,setProgress]=useState<Record<string,number>>({}),[receipt,setReceipt]=useState<Receipt|null>(null);
 const pick=()=>a.run(async()=>{const result=await DocumentPicker.getDocumentAsync({multiple:true,copyToCacheDirectory:true,type:'*/*',base64:false});if(result.canceled)return;if(result.assets.reduce((n,f)=>n+(f.size??0),0)>50*1024**2)throw new Error('Demo uploads are limited to 50 MB per card.');setFiles(result.assets);setProgress({});setReceipt(null);});
 const upload=()=>a.run(async()=>{
  if(!files.length)throw new Error('Select your files first.');
  const contents=new Map<string,Uint8Array>();let total=0;
  for(const f of files){if(contents.has(f.name))throw new Error('Each file in the card needs a unique name.');const buffer=Platform.OS==='web'&&f.file?await f.file.arrayBuffer():await new NativeFile(f.uri).arrayBuffer();total+=buffer.byteLength;if(total>50*1024**2)throw new Error('Demo uploads are limited to 50 MB per card.');contents.set(f.name,new Uint8Array(buffer));}
  const manifest=await Promise.all(files.map(async f=>{const bytes=contents.get(f.name)!;const hash=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,new Uint8Array(bytes).buffer);return {filename:f.name,bytes:bytes.byteLength,checksum:Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join(''),kind};}));
  const key=`kamraw:upload:${user!.id}:${route.params.sessionId}:${kind}`,signature=manifest.map(f=>`${f.filename}:${f.checksum}`).sort().join('|'),cached=await AsyncStorage.getItem(key);let card:Upload;
  if(cached&&JSON.parse(cached).signature===signature)card=await api<Upload>(`/uploads/${JSON.parse(cached).id}`);
  else{if(cached){await api(`/uploads/${JSON.parse(cached).id}/abandon`,{});await AsyncStorage.removeItem(key);}card=await api<Upload>('/uploads',{sessionId:route.params.sessionId,files:manifest});await AsyncStorage.setItem(key,JSON.stringify({id:card.id,signature}));}
  for(const asset of card.assets){const bytes=contents.get(asset.filename);if(!bytes)throw new Error(`Reselect ${asset.filename} to resume.`);let offset=Number(asset.received_bytes);if(asset.status==='verified'){setProgress(p=>({...p,[asset.filename]:100}));continue;}while(offset<bytes.byteLength){const part=bytes.slice(offset,offset+2*1024**2),result=await api<{receivedBytes:number;status:string}>(`/assets/${asset.id}/chunks?offset=${offset}`,part,'PUT');if(result.status==='checksum_failed')throw new Error(`${asset.filename} failed verification. Reselect the same files and retry.`);if(result.receivedBytes<=offset)throw new Error('Upload did not advance. Retry when your connection improves.');offset=result.receivedBytes;setProgress(p=>({...p,[asset.filename]:Math.round(offset/bytes.byteLength*100)}));}}
  const result=await api<Receipt>(`/uploads/${card.id}/receipt`,{});setReceipt(result);if(result.demoVerified||result.safeToFormat)await AsyncStorage.removeItem(key);
 });
 return <Page><Text style={styles.eyebrow}>CREATOR MEDIA</Text><Text style={styles.title}>Every frame, accounted for.</Text><Text style={styles.subtitle}>Choose files from this device. After a network interruption, reselect the same files to continue from the last verified chunk.</Text><Chips values={['original','edited'] as const} value={kind} onChange={setKind}/><Text style={styles.label}>Demo limit: 50 MB per card. Keep your original card.</Text><ErrorNotice message={a.error}/><Button title="Choose card files" secondary disabled={a.busy} onPress={()=>void pick()}/>{files.map(f=><Card key={f.name}><Text style={styles.body}>{f.name}</Text><View accessibilityRole="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress[f.name]??0}><Text style={styles.subtitle}>{progress[f.name]??0}% uploaded</Text></View></Card>)}<Button title="Upload / resume card" busy={a.busy} disabled={!files.length} onPress={()=>void upload()}/>{receipt&&<Card><Text style={styles.section}>{receipt.demoVerified?'Demo files verified':'Verification result'}</Text><Text style={styles.body}>{receipt.files} files · {(receipt.bytes/1024**2).toFixed(1)} MB</Text><Text style={styles.subtitle}>{receipt.message}</Text></Card>}</Page>;
}
