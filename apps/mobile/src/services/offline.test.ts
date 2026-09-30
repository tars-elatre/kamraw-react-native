import AsyncStorage from '@react-native-async-storage/async-storage';
import {enqueue,flushQueue,readQueue} from './offline';
import {ApiError} from './api';
let storage:string|null=null;
beforeEach(()=>{storage=null;jest.mocked(AsyncStorage.getItem).mockImplementation(async()=>storage);jest.mocked(AsyncStorage.setItem).mockImplementation(async(_k,v)=>{storage=v;});});
test('concurrent offline events are persisted without losing either',async()=>{await Promise.all([enqueue({id:'1',path:'/event',body:{},accountId:'a'}),enqueue({id:'2',path:'/event',body:{},accountId:'a'})]);expect(await readQueue()).toHaveLength(2);});
test('network failure retains event for safe idempotent retry',async()=>{await enqueue({id:'1',path:'/event',body:{clientId:'1'},accountId:'a'});await flushQueue('a',async()=>{throw new ApiError(0,'NETWORK','offline');});expect(await readQueue()).toHaveLength(1);await flushQueue('a',async()=>({synced:true}));expect(await readQueue()).toHaveLength(0);});
test('switching accounts cannot upload another creator’s offline events',async()=>{await enqueue({id:'1',path:'/event',body:{},accountId:'a'});const send=jest.fn();await flushQueue('b',send);expect(send).not.toHaveBeenCalled();expect(await readQueue()).toHaveLength(1);});
