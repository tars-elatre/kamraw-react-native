import AsyncStorage from '@react-native-async-storage/async-storage';
import {ApiError} from './api';
export interface QueuedEvent {id:string;path:string;body:unknown;accountId:string;error?:string}
const key='kamraw:session-events:v1';
let lock=Promise.resolve();
function exclusive<T>(action:()=>Promise<T>):Promise<T>{const p=lock.then(action);lock=p.then(()=>{},()=>{});return p;}
export const readQueue=async():Promise<QueuedEvent[]>=>JSON.parse(await AsyncStorage.getItem(key)??'[]');
export const enqueue=(event:QueuedEvent)=>exclusive(async()=>{const items=await readQueue();if(!items.some(x=>x.id===event.id))items.push(event);await AsyncStorage.setItem(key,JSON.stringify(items));});
export const flushQueue=(accountId:string,send:(path:string,body:unknown)=>Promise<unknown>)=>exclusive(async()=>{const items=await readQueue(),remaining:QueuedEvent[]=[];for(const item of items){if(item.accountId!==accountId){remaining.push(item);continue;}try{await send(item.path,item.body);}catch(e){remaining.push({...item,error:e instanceof Error?e.message:'Sync failed'});if(e instanceof ApiError&&e.status===0){remaining.push(...items.slice(items.indexOf(item)+1));break;}}}await AsyncStorage.setItem(key,JSON.stringify(remaining));return remaining;});
