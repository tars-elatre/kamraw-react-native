import {request,ApiError} from './api';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
test('upload sends exact binary bytes with the authenticated chunk request',async()=>{
 const fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({data:{receivedBytes:3,status:'uploading'}})});globalThis.fetch=fetch;
 await expect(request('/assets/asset/chunks?offset=0','demo:creator',new Uint8Array([0,127,255]),'PUT')).resolves.toMatchObject({receivedBytes:3});
 const [,options]=fetch.mock.calls[0]!;expect(options.headers['Content-Type']).toBe('application/octet-stream');expect(options.headers.Authorization).toBe('Bearer demo:creator');expect(Array.from(new Uint8Array(options.body))).toEqual([0,127,255]);
});
test('server permission errors remain distinguishable from a lost connection',async()=>{
 globalThis.fetch=jest.fn().mockResolvedValue({ok:false,status:403,json:async()=>({error:{code:'FORBIDDEN',message:'Permission required'}})});
 await expect(request('/notifications')).rejects.toMatchObject({status:403,code:'FORBIDDEN'});
 globalThis.fetch=jest.fn().mockRejectedValue(new TypeError('Network unavailable'));
 await expect(request('/notifications')).rejects.toEqual(expect.objectContaining({status:0,code:'NETWORK'}));
 expect(new ApiError(409,'CONFLICT','Changed')).toBeInstanceOf(Error);
});

test.each(['https://demo.kamraw.com','https://demo.kamraw.com/','https://demo.kamraw.com/api',' https://demo.kamraw.com/api/ '])('mobile accepts an API origin or API base path: %s',async configured=>{
 const previous=process.env.EXPO_PUBLIC_API_URL;process.env.EXPO_PUBLIC_API_URL=configured;
 const fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({data:{id:'account'}})});globalThis.fetch=fetch;
 try{let configuredRequest=request;jest.isolateModules(()=>{configuredRequest=jest.requireActual<typeof import('./api')>('./api').request;});await configuredRequest('/me','sample-session');expect(fetch.mock.calls[0]![0]).toBe('https://demo.kamraw.com/api/me');}
 finally{if(previous===undefined)delete process.env.EXPO_PUBLIC_API_URL;else process.env.EXPO_PUBLIC_API_URL=previous;}
});
