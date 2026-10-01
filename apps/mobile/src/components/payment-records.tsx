import React,{useState} from 'react';
import {Text,View} from 'react-native';
import {formatMoney} from '@kamraw/domain';
import {Button,Card,ErrorNotice,styles} from './ui';
import {useSession} from '../services/session';
import {useAction,useLoad} from '../services/use-load';
import {savePdf} from '../services/download';
interface RecordDetail {
  payments:{id:string;amount_paise:number;provider:string}[];
  refunds:{id:string;amount_paise:number;fee_paise:number;status:string}[];
  changes:{id:string;kind:string;delta_paise:number}[];
  prints:{id:string;total_paise:number;status:string}[];
}
function Record({id}:{id:string}){
  const load=useLoad<RecordDetail>(`/orders/${id}/payment-record`),{api,demo}=useSession(),a=useAction();
  return <View style={{gap:12}}><ErrorNotice message={load.error??a.error}/>
    {load.data?.payments.map(p=><Text key={p.id} style={styles.body}>Booking payment · {formatMoney(p.amount_paise)}{demo?' · simulated':''}</Text>)}
    {load.data?.changes.map(c=><Text key={c.id} style={styles.body}>{c.kind} · {formatMoney(c.delta_paise)}{demo?' · simulated':''}</Text>)}
    {load.data?.refunds.map(r=><View key={r.id}><Text style={styles.body}>Refund · {formatMoney(r.amount_paise)} · {r.status.replaceAll('_',' ')}</Text><Text style={styles.subtitle}>Cancellation fee · {formatMoney(r.fee_paise)}</Text></View>)}
    {load.data?.prints.map(p=><Text key={p.id} style={styles.body}>Album {p.id.slice(0,8)} · {formatMoney(p.total_paise)} · {p.status.replaceAll('_',' ')}</Text>)}
    <Button title={demo?'Download demo statement (PDF)':'Download invoice'} secondary busy={a.busy} onPress={()=>void a.run(async()=>{const file=await api<{filename:string;base64:string}>(`/orders/${id}/statement`);await savePdf(file.filename,file.base64);})}/>
  </View>;
}
export function PaymentRecords(){
  const [page,setPage]=useState(1),[expanded,setExpanded]=useState<string|null>(null);
  const load=useLoad<{orders:{id:string;code:string;status:string;total_paise:number}[];hasMore:boolean;demo:boolean}>(`/payment-records?page=${page}`);
  return <Card><Text style={styles.section}>Payments & refunds</Text>
    {load.data?.demo&&<Text style={styles.subtitle}>Demo transactions only. Sample statements are not GST tax invoices.</Text>}
    <ErrorNotice message={load.error}/>{!load.loading&&!load.data?.orders.length&&<Text style={styles.subtitle}>Your booking payments will appear here.</Text>}
    {load.data?.orders.map(o=><View key={o.id} style={{gap:12}}><Text style={styles.body}>{o.code} · {formatMoney(o.total_paise)} · {o.status.replaceAll('_',' ')}</Text><Button title={expanded===o.id?'Hide payment details':'View payment details'} secondary onPress={()=>setExpanded(expanded===o.id?null:o.id)}/>{expanded===o.id&&<Record id={o.id}/>}</View>)}
    <View style={styles.row}><Button title="Previous" secondary disabled={page===1} onPress={()=>{setPage(page-1);setExpanded(null);}}/><Button title="Next" secondary disabled={!load.data?.hasMore} onPress={()=>{setPage(page+1);setExpanded(null);}}/></View>
    <Button title="Refresh payments" secondary onPress={()=>void load.refresh()}/>
  </Card>;
}
