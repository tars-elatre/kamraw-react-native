import React from 'react';
import {act,render,screen,userEvent} from '@testing-library/react-native';
import {SessionTiming} from './session-timing';
const mockApi=jest.fn(),mockRefresh=jest.fn(),mockLocation=jest.fn();
const date='2026-10-01T06:00:00.000Z';
let mockTiming:Record<string,unknown>;
jest.mock('../services/session',()=>({useSession:()=>({api:mockApi,user:{language:'en'}})}));
jest.mock('../services/use-load',()=>({...jest.requireActual('../services/use-load'),useLoad:()=>({data:mockTiming,error:null,loading:false,refresh:mockRefresh})}));
jest.mock('expo-crypto',()=>({randomUUID:()=> 'checkout-id'}));
jest.useFakeTimers();
beforeEach(()=>{jest.clearAllMocks();jest.setSystemTime(new Date(date));mockApi.mockResolvedValue({});mockRefresh.mockResolvedValue(undefined);mockLocation.mockResolvedValue({lat:13.08,lng:80.27,accuracy:5});mockTiming={serverTime:date,customer:false,venueAllowsOverrun:true,bookedEnd:date,lateCreditPaise:0,roles:[{role_id:'role',name:'Karthik',status:'in_session',checked_in_at:date,service_end_at:'2026-10-01T06:00:02.000Z',late:false,overrun_conflict:false,request_id:null,request_status:null}]};});
test('checkout stays disabled until the agreed end and sends fresh location evidence',async()=>{
 const user=userEvent.setup();await render(<SessionTiming sessionId="shoot" roleId="role" status="in_session" location={mockLocation}/>);
 expect(screen.getByRole('button',{name:'Customer unavailable · End shoot'})).toBeDisabled();expect(mockLocation).not.toHaveBeenCalled();
 await act(async()=>{jest.advanceTimersByTime(2000);});expect(screen.getByRole('button',{name:'Customer unavailable · End shoot'})).toBeEnabled();
 await user.press(screen.getByRole('button',{name:'Customer unavailable · End shoot'}));expect(mockApi).toHaveBeenCalledWith('/creator/roles/role/completion-request',{clientId:'checkout-id',location:{lat:13.08,lng:80.27,accuracy:5}});expect(mockRefresh).toHaveBeenCalled();expect(screen.getByText('Checkout location saved. The customer has one hour to confirm or raise an issue.')).toBeOnTheScreen();
});
test('a customer can pause completion with a reason and a disputed request stays under review',async()=>{
 const role={...(mockTiming.roles as Record<string,unknown>[])[0],request_id:'request',request_status:'pending',available_after:'2026-10-01T07:00:00.000Z'};mockTiming={...mockTiming,customer:true,roles:[role]};
 const user=userEvent.setup(),view=await render(<SessionTiming sessionId="shoot"/>);expect(screen.getByRole('button',{name:'Ask operations to review'})).toBeDisabled();
 await user.type(screen.getByLabelText('Issue with completion'),'The shoot is not finished');await user.press(screen.getByRole('button',{name:'Ask operations to review'}));expect(mockApi).toHaveBeenCalledWith('/completion-requests/request/decision',{action:'dispute',reason:'The shoot is not finished'});
 mockTiming={...mockTiming,roles:[{...role,request_status:'disputed'}]};await view.rerender(<SessionTiming sessionId="shoot"/>);expect(screen.getByText('Automatic completion is paused for operations review.')).toBeOnTheScreen();expect(screen.queryByRole('button',{name:'Ask operations to review'})).toBeNull();expect(screen.getByRole('button',{name:'Confirm the shoot is complete'})).toBeOnTheScreen();
});
