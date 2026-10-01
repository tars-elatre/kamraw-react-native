import {bookingSchema,type BookingInput} from '@kamraw/domain';
const labels:Record<string,string>={address:'Enter a venue address with at least five characters.',contactName:'Enter the name of your venue contact.',contactPhone:'Enter the contact’s Indian mobile number, including +91.',lat:'Enter a valid venue latitude.',lng:'Enter a valid venue longitude.',hours:'Choose a whole number of hours from 2 to 10.',count:'Choose a valid number of creators.',start:'Enter a valid shoot date and time.',roles:'Choose up to five crew roles.',sessions:'A booking can include up to twelve sessions.',notes:'Shorten the notes before continuing.'};
export function validateBooking(value:unknown):BookingInput{
 const result=bookingSchema.safeParse(value);if(result.success)return result.data;
 const issue=result.error.issues[0]!,field=String(issue.path[issue.path.length-1]??''),session=issue.path[0]==='sessions'&&typeof issue.path[1]==='number'?`Session ${issue.path[1]+1}: `:'';
 throw new Error(`${session}${labels[field]??'Check your booking details before continuing.'}`);
}
