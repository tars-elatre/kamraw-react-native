import {validateBooking} from './booking-validation';
const session={start:'2026-10-11T05:30:00Z',mode:'scheduled',hours:2,venue:{lat:13.08,lng:80.27,address:'Demo event hall',type:'hall',contactName:'Host',contactPhone:'+919000000001'},roles:[{discipline:'photo',tier:'T1',count:1}],style:'candid',preferences:{femaleCreator:false},addons:[]};
test('incomplete venue details produce a usable correction instead of raw schema JSON',()=>{
 expect(()=>validateBooking({category:'birthday',termsVersion:'demo-v1',sessions:[{...session,venue:{...session.venue,address:''}}]})).toThrow('Session 1: Enter a venue address with at least five characters.');
 expect(()=>validateBooking({category:'birthday',termsVersion:'demo-v1',sessions:[session,{...session,venue:{...session.venue,contactPhone:'123'}}]})).toThrow('Session 2: Enter the contact’s Indian mobile number, including +91.');
 expect(validateBooking({category:'birthday',termsVersion:'demo-v1',sessions:[session]}).sessions).toHaveLength(1);
});
