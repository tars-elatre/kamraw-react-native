import type {SessionInput,Price,RateCard,Zone} from '@kamraw/domain';
export interface Catalog {rates:RateCard;zones:Zone[];categories:string[];earliestStart:string;mode:string}
export interface Order {id:string;code:string;category:string;status:string;totalPaise:number;createdAt:string}
export interface SessionRow {id:string;input:SessionInput;status:string;startAt:string;endAt:string;completionCode:string}
export interface OrderDetail extends Order {sessions:SessionRow[];price:Price;roles:{id:string;session_id:string;creator_name:string|null;tier:string;discipline:string}[]}
export interface Gallery {id:string;code:string;category:string;status:string;expires_at:string|null;assets?:{id:string;filename:string;bytes:string;width:number;height:number}[]}
export interface Job {id:string;role_id:string;code:string;status:string;input:SessionInput;start_at:string;end_at:string;earning_paise:number;discipline:string;tier:string}
export interface Offer {id:string;category:string;start_at:string;end_at:string;zone_id:string;discipline:string;tier:string;earning_paise:number;expires_at:string}
export type Routes={Main:{screen?:'Discover'|'Bookings'|'Galleries'|'You'}|undefined;Book:{mode:'on_demand'|'scheduled';category?:'birthday'|'ceremony'|'engagement'|'wedding'|'reception'|'corporate'|'portrait'|'brand'};Booking:{id:string};Gallery:{id:string};Job:{job:Job};Support:undefined;Onboarding:undefined;Album:{gallery:Gallery}};
