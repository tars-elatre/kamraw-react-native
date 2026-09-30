import React,{useCallback,useEffect,useState} from 'react';
import {request} from './api';
import {useSession} from './auth';
export function useApi(){const {token}=useSession();return async<T,>(path:string,body?:unknown,method?:string)=>request<T>(path,await token(),body,method);}
export function useLoad<T>(path:string){const api=useApi(),[data,setData]=useState<T|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);const refresh=useCallback(async()=>{setLoading(true);setError(null);try{setData(await api<T>(path));}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[path]);useEffect(()=>{void refresh();},[refresh]);return {data,loading,error,refresh};}
export function useAction(){const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState<string|null>(null);return {busy,error,success,setSuccess,run:async(fn:()=>Promise<void>)=>{setBusy(true);setError(null);setSuccess(null);try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}};}
export const Notice=({error,success}:{error?:string|null;success?:string|null})=><>{error&&<div className="notice error" role="alert">{error}</div>}{success&&<div className="notice success" role="status">{success}</div>}</>;
export const Empty=({title,body}:{title:string;body:string})=><div className="empty"><span className="empty-orbit">◌</span><h3>{title}</h3><p>{body}</p></div>;
export const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="field"><span>{label}</span>{children}</label>;
export const Badge=({status}:{status:string})=><span className={`badge ${['confirmed','open','pending','applied'].includes(status)?'amber':['cancelled','suspended','rejected'].includes(status)?'red':'green'}`}>{status.replaceAll('_',' ')}</span>;
