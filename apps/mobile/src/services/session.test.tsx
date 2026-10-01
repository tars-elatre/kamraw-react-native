import React from 'react';
import {Text,Button} from 'react-native';
import {render,screen,userEvent} from '@testing-library/react-native';
import {SessionProvider,useSession} from './session';
import {ApiError,request} from './api';
import * as SecureStore from 'expo-secure-store';
jest.mock('./api',()=>({...jest.requireActual('./api'),request:jest.fn()}));
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn(),setItemAsync:jest.fn(),deleteItemAsync:jest.fn()}));
const mockRequest=jest.mocked(request),credentials={token:'kmr_test',expiresAt:'2099-01-01T00:00:00Z',demo:true,account:{id:'account',name:'Demo customer',role:'customer',language:'en',consents:{}}};
function Screen(){const s=useSession();return <><Text>{s.loading?'Loading':s.user?.name??'Signed out'}</Text><Button title="Enter demo" onPress={()=>void s.login('customer')}/><Button title="Sign out" onPress={()=>void s.logout()}/><Button title="Load orders" onPress={()=>void s.api('/orders').catch(()=>{})}/></>;}
beforeEach(()=>{jest.clearAllMocks();process.env.EXPO_PUBLIC_APP_MODE='demo';jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);jest.mocked(SecureStore.setItemAsync).mockResolvedValue();jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue();});
test('mobile sign-in stores backend credentials securely and sign-out revokes them',async()=>{
 mockRequest.mockImplementation(async path=>path==='/auth/demo'?credentials:{signedOut:true});const user=userEvent.setup();await render(<SessionProvider><Screen/></SessionProvider>);await screen.findByText('Signed out');await user.press(screen.getByRole('button',{name:'Enter demo'}));expect(await screen.findByText('Demo customer')).toBeOnTheScreen();expect(SecureStore.setItemAsync).toHaveBeenCalledWith('kamraw-session-v1',JSON.stringify(credentials));await user.press(screen.getByRole('button',{name:'Sign out'}));expect(mockRequest).toHaveBeenCalledWith('/auth/logout','kmr_test',{});expect(await screen.findByText('Signed out')).toBeOnTheScreen();expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});
test('a temporary network failure preserves the cached mobile account, while a rejected session signs out',async()=>{
 jest.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(credentials));mockRequest.mockRejectedValueOnce(new ApiError(0,'NETWORK','Offline')).mockRejectedValueOnce(new ApiError(401,'SESSION_EXPIRED','Sign in again'));const user=userEvent.setup();await render(<SessionProvider><Screen/></SessionProvider>);expect(await screen.findByText('Demo customer')).toBeOnTheScreen();expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();await user.press(screen.getByRole('button',{name:'Load orders'}));expect(await screen.findByText('Signed out')).toBeOnTheScreen();expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});
