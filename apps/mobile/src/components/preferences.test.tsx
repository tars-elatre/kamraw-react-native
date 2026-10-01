import React from 'react';
import {fireEvent,render,screen,userEvent} from '@testing-library/react-native';
import {BookingPreferences,PreferenceReview} from './preferences';
const mockApi=jest.fn(),mockRefresh=jest.fn();
let mockDetail:Record<string,unknown>;
jest.mock('../services/session',()=>({useSession:()=>({api:mockApi,user:{language:'en'}})}));
jest.mock('../services/use-load',()=>({...jest.requireActual('../services/use-load'),useLoad:()=>({data:mockDetail,error:null,loading:false,refresh:mockRefresh})}));
jest.useFakeTimers();
beforeEach(()=>{jest.clearAllMocks();mockApi.mockResolvedValue({});mockRefresh.mockResolvedValue(undefined);mockDetail={status:'assigned',customer:true,preferences:{language:'hi',femaleCreator:true},roles:[{reviewId:'review',roleId:'role',name:'Sample',discipline:'photo',tier:'T1',unmet:['language','femaleCreator'],acceptedAt:null}],canCancelFree:true};});
test('language and female creator are explicitly optional booking preferences',async()=>{
 const change=jest.fn(),user=userEvent.setup();await render(<BookingPreferences value={{femaleCreator:false}} onChange={change}/>);
 await user.press(screen.getByRole('radio',{name:'हिन्दी'}));expect(change).toHaveBeenLastCalledWith({femaleCreator:false,language:'hi'});
 fireEvent(screen.getByRole('switch',{name:'Female creator preference'}),'valueChange',true);expect(change).toHaveBeenLastCalledWith({femaleCreator:true});
 expect(screen.getByText(/we tell you before travel/)).toBeOnTheScreen();
});
test('unmet preferences require explicit acceptance of current assignment IDs',async()=>{
 const user=userEvent.setup();await render(<PreferenceReview sessionId="shoot"/>);
 expect(screen.getByText(/Preferred language unavailable/)).toBeOnTheScreen();await user.press(screen.getByRole('button',{name:'Continue with these creators'}));
 expect(mockApi).toHaveBeenCalledWith('/sessions/shoot/preferences/accept',{reviewIds:['review']});expect(mockRefresh).toHaveBeenCalled();
});
test('free cancellation previews before submitting and creators cannot decide for customers',async()=>{
 const user=userEvent.setup();mockApi.mockResolvedValue({feePaise:0,refundPaise:12000});const view=await render(<PreferenceReview sessionId="shoot"/>);
 expect(screen.queryByRole('button',{name:'Confirm cancellation and refund'})).toBeNull();await user.press(screen.getByRole('button',{name:'Review fee-free cancellation'}));expect(mockApi).not.toHaveBeenCalledWith('/sessions/shoot/cancel',expect.anything());
 await user.press(screen.getByRole('button',{name:'Confirm cancellation and refund'}));expect(mockApi).toHaveBeenCalledWith('/sessions/shoot/cancel',{expectedFeePaise:0});
 mockDetail={...mockDetail,customer:false};await view.rerender(<PreferenceReview sessionId="shoot"/>);expect(screen.queryByRole('button',{name:'Continue with these creators'})).toBeNull();expect(screen.getByText(/Wait for the customer/)).toBeOnTheScreen();
 mockDetail={...mockDetail,roles:[{reviewId:'review',roleId:'role',name:'Sample',discipline:'photo',tier:'T1',unmet:['language'],acceptedAt:'2026-10-01T10:00:00Z'}]};await view.rerender(<PreferenceReview sessionId="shoot"/>);expect(screen.getByText('The customer accepted this assignment')).toBeOnTheScreen();
});
