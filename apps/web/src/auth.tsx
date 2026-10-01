import React,{createContext,useContext,useEffect,useState} from 'react';
import {request,type User} from './api';
interface Credentials {token:string;expiresAt:string;account:User;demo:boolean}
interface Challenge {challengeId:string;phone:string;expiresAt:string;retryAfterSeconds:number;demo:boolean;demoCode?:string}
interface Auth {user:User|null;token:()=>Promise<string>;login:(handle?:string)=>Promise<void>;logout:()=>Promise<void>;loading:boolean;demo:boolean;error:string|null;requestCode:(phone:string)=>Promise<Challenge>;verifyCode:(challengeId:string,code:string)=>Promise<void>}
const Ctx=createContext<Auth|null>(null),key='kamraw-web-session-v1';
export function useSession(){return useContext(Ctx)!;}
export function SessionProvider({children}:{children:React.ReactNode}){
 const [credentials,setCredentials]=useState<Credentials|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true),demo=import.meta.env.VITE_APP_MODE==='demo';
 const save=(c:Credentials)=>{sessionStorage.setItem(key,JSON.stringify(c));setCredentials(c);setError(null);};
 const clear=()=>{sessionStorage.removeItem(key);setCredentials(null);};
 useEffect(()=>{void(async()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return;const c=JSON.parse(raw) as Credentials;if(!c.token||c.demo!==demo||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now()){clear();return;}const account=await request<User>('/me',c.token);save({...c,account});}catch(e){setError((e as Error).message);clear();}finally{setLoading(false);}})();},[]);
 return <Ctx.Provider value={{user:credentials?.account??null,error,loading,demo,token:async()=>{if(!credentials||Date.parse(credentials.expiresAt)<=Date.now()){clear();throw new Error('Please sign in again');}return credentials.token;},login:async(handle='ops')=>save(await request<Credentials>('/auth/demo',null,{handle})),requestCode:phone=>request<Challenge>('/auth/phone/start',null,{phone}),verifyCode:async(challengeId,code)=>save(await request<Credentials>('/auth/phone/verify',null,{challengeId,code})),logout:async()=>{try{await request('/auth/logout',credentials?.token??null,{});}finally{clear();}}}}>{children}</Ctx.Provider>;
}
