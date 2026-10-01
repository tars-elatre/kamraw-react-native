import React from 'react';
import {act,render,screen,userEvent} from '@testing-library/react-native';
import {PhoneSignIn} from './phone-sign-in';
const mockStart=jest.fn(),mockVerify=jest.fn();
jest.mock('../services/session',()=>({useSession:()=>({requestCode:mockStart,verifyCode:mockVerify,demo:true})}));
jest.useFakeTimers();
beforeEach(()=>{jest.clearAllMocks();jest.setSystemTime(new Date('2026-10-01T06:00:00Z'));mockStart.mockResolvedValue({challengeId:'challenge',phone:'+919000000001',expiresAt:'2026-10-01T06:05:00Z',retryAfterSeconds:60,demo:true,demoCode:'012345'});mockVerify.mockResolvedValue(undefined);});
test('phone sign-in validates the number and completes with the displayed demo code',async()=>{
 const user=userEvent.setup();await render(<PhoneSignIn/>);expect(screen.getByRole('button',{name:'Get demo verification code'})).toBeDisabled();await user.type(screen.getByLabelText('Mobile number'),'9000000001');await user.type(screen.getByLabelText('Your name (for a new account)'),'Demo tester');await user.press(screen.getByRole('button',{name:'Get demo verification code'}));expect(mockStart).toHaveBeenCalledWith('9000000001');expect(screen.getByText('Demo code · 012345')).toBeOnTheScreen();expect(screen.getByRole('button',{name:'Verify and continue'})).toBeDisabled();await user.type(screen.getByLabelText('Six-digit verification code'),'012345');await user.press(screen.getByRole('button',{name:'Verify and continue'}));expect(mockVerify).toHaveBeenCalledWith('challenge','012345','Demo tester');
});
test('failed verification stays recoverable and expiry prevents submitting an old code',async()=>{
 mockVerify.mockRejectedValue(new Error('This code is invalid or expired.'));const user=userEvent.setup();await render(<PhoneSignIn/>);await user.type(screen.getByLabelText('Mobile number'),'+91 90000 00001');await user.press(screen.getByRole('button',{name:'Get demo verification code'}));await user.type(screen.getByLabelText('Six-digit verification code'),'654321');await user.press(screen.getByRole('button',{name:'Verify and continue'}));expect(screen.getByText('This code is invalid or expired.')).toBeOnTheScreen();expect(screen.getByRole('button',{name:/Resend code in/})).toBeDisabled();await act(async()=>{jest.advanceTimersByTime(5*60000);});expect(screen.getByRole('button',{name:'Verify and continue'})).toBeDisabled();await user.press(screen.getByRole('button',{name:'Resend code'}));expect(mockStart).toHaveBeenLastCalledWith('+919000000001');expect(mockStart).toHaveBeenCalledTimes(2);
});
