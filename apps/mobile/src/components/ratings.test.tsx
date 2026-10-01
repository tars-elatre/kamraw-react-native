import React from 'react';
import {render,screen,userEvent} from '@testing-library/react-native';
import {Rating} from './ratings';
const mockApi=jest.fn();
let mockFeedback:{ratings:{id:string;kind:string;creator_id:string|null;stars:number;comment:string;tags:string[]}[];windows:{session:{open:boolean;closesAt:string|null};delivery:{open:boolean;closesAt:string|null}}};
const mockRefresh=jest.fn();
jest.mock('../services/session',()=>({useSession:()=>({api:mockApi,user:{language:'en'}})}));
jest.mock('../services/use-load',()=>({...jest.requireActual('../services/use-load'),useLoad:(path:string)=>({data:path.endsWith('/creators')?[{id:'first',name:'Karthik',tier:'T1',discipline:'photo'},{id:'second',name:'Senthil',tier:'T1',discipline:'photo'}]:mockFeedback,error:null,loading:false,refresh:mockRefresh})}));
jest.useFakeTimers();
beforeEach(()=>{jest.clearAllMocks();mockApi.mockResolvedValue({});mockFeedback={ratings:[],windows:{session:{open:true,closesAt:null},delivery:{open:false,closesAt:null}}};});
test('a customer can review the second crew member without resubmitting the first review',async()=>{
 mockFeedback.ratings=[{id:'review',kind:'creator',creator_id:'first',stars:4,comment:'Recorded for Karthik',tags:[]}];const user=userEvent.setup();await render(<Rating sessionId="shoot"/>);
 expect(screen.getByText('Recorded for Karthik')).toBeOnTheScreen();expect(screen.queryByRole('button',{name:'Submit review'})).toBeNull();await user.press(screen.getByRole('radio',{name:'Review Senthil'}));expect(screen.getByRole('radio',{name:'Review Senthil'})).toBeChecked();expect(screen.getByRole('radio',{name:'Review Karthik'})).not.toBeChecked();await user.press(screen.getByRole('checkbox',{name:'punctual'}));await user.type(screen.getByLabelText('Your review'),'Arrived on time');await user.press(screen.getByRole('button',{name:'Submit review'}));
 expect(mockApi).toHaveBeenCalledWith('/sessions/shoot/ratings',{kind:'creator',creatorId:'second',stars:5,tags:['punctual'],comment:'Arrived on time'});expect(mockRefresh).toHaveBeenCalled();
});
test('creators review customers and closed delivery feedback cannot be submitted',async()=>{
 const user=userEvent.setup();await render(<Rating sessionId="shoot" asCreator/>);expect(screen.queryByRole('radio',{name:'creator'})).toBeNull();await user.press(screen.getByRole('button',{name:'Submit review'}));expect(mockApi).toHaveBeenCalledWith('/sessions/shoot/ratings',expect.objectContaining({kind:'customer'}));
 await render(<Rating sessionId="other"/>);await user.press(screen.getByRole('radio',{name:'delivery'}));expect(screen.getByText('This review opens after the work is complete.')).toBeOnTheScreen();expect(screen.queryByRole('button',{name:'Submit review'})).toBeNull();
});
