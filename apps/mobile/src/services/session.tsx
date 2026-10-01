import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {Platform} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {ApiError,request} from './api';
export interface User {id:string;name:string;role:string;language:'en'|'ta';consents:Record<string,boolean>}
export interface PhoneChallenge {challengeId:string;phone:string;expiresAt:string;retryAfterSeconds:number;demo:boolean;demoCode?:string}
interface Credentials {token:string;expiresAt:string;account:User;demo:boolean}
interface Session {user:User|null;loading:boolean;demo:boolean;login:(handle?:string)=>Promise<void>;logout:()=>Promise<void>;api:<T>(path:string,body?:unknown,method?:string)=>Promise<T>;refresh:()=>Promise<void>;requestCode:(phone:string)=>Promise<PhoneChallenge>;verifyCode:(challengeId:string,code:string,name?:string)=>Promise<void>}
const Context=createContext<Session|null>(null),key='kamraw-session-v1';
export const useSession=()=>{const s=useContext(Context);if(!s)throw new Error('Session provider missing');return s;};
const storage={get:()=>Platform.OS==='web'?Promise.resolve(sessionStorage.getItem(key)):SecureStore.getItemAsync(key),set:(value:string)=>Platform.OS==='web'?Promise.resolve(sessionStorage.setItem(key,value)):SecureStore.setItemAsync(key,value),clear:()=>Platform.OS==='web'?Promise.resolve(sessionStorage.removeItem(key)):SecureStore.deleteItemAsync(key)};
export function SessionProvider({children}:{children:React.ReactNode}){
 const credentials=useRef<Credentials|null>(null),[user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),demo=process.env.EXPO_PUBLIC_APP_MODE==='demo';
 const forget=async()=>{credentials.current=null;setUser(null);await storage.clear();};
 const save=async(c:Credentials)=>{await storage.set(JSON.stringify(c));credentials.current=c;setUser(c.account);};
 useEffect(()=>{let mounted=true;void(async()=>{try{const raw=await storage.get();if(!raw)return;const c=JSON.parse(raw) as Credentials;if(!c.token||!c.account||c.demo!==demo||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now()){await storage.clear();return;}if(!mounted)return;credentials.current=c;setUser(c.account);try{const account=await request<User>('/me',c.token);if(mounted)await save({...c,account});}catch(e){if(e instanceof ApiError&&e.status===401&&mounted)await forget();}}catch{if(mounted)await forget();}finally{if(mounted)setLoading(false);}})();return()=>{mounted=false;};},[]);
 const api=async<T,>(path:string,body?:unknown,method?:string)=>{try{return await request<T>(path,credentials.current?.token,body,method);}catch(e){if(e instanceof ApiError&&e.status===401)await forget();throw e;}};
 return <Context.Provider value={{user,loading,demo,api,login:async(handle='customer')=>save(await request<Credentials>('/auth/demo',undefined,{handle})),requestCode:phone=>request<PhoneChallenge>('/auth/phone/start',undefined,{phone}),verifyCode:async(challengeId,code,name)=>save(await request<Credentials>('/auth/phone/verify',undefined,{challengeId,code,name})),logout:async()=>{const token=credentials.current?.token;try{await request('/auth/logout',token,{});}finally{await forget();}},refresh:async()=>{const account=await api<User>('/me');if(credentials.current)await save({...credentials.current,account});}}}>{children}</Context.Provider>;
}
