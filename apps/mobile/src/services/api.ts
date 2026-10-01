export class ApiError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export const apiBase=process.env.EXPO_PUBLIC_API_URL||'http://localhost:4000';
export async function request<T>(path:string,token?:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{const binary=body instanceof Uint8Array;const res=await fetch(`${apiBase}/api${path}`,{method,headers:{'Content-Type':binary?'application/octet-stream':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:binary?new Uint8Array(body).buffer:JSON.stringify(body),signal:controller.signal});const data=await res.json();if(!res.ok)throw new ApiError(res.status,data.error?.code??'REQUEST_FAILED',data.error?.message??'Please try again');return data.data as T;}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(0,'NETWORK','Unable to connect. Check your internet connection and try again.');}finally{clearTimeout(timer);}
}
