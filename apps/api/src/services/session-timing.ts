import {z} from 'zod';
import type {EntityManager} from 'typeorm';
import {distanceMetres,pointSchema} from '@kamraw/domain';
import {RoleEntity,SessionEntity,type Role,type Session} from '../entities';
import {PlatformRepository} from '../repositories/platform';
import {AppError,requireValue} from '../middleware/errors';
import {refreshSessionState} from './session-state';
const locationSchema=pointSchema.extend({accuracy:z.number().min(0).max(100)});
interface Timing {role_id:string;name:string;status:string;checked_in_at:Date|null;actual_started_at:Date|null;actual_completed_at:Date|null;service_end_at:Date;late:boolean;overrun_conflict:boolean;request_id:string|null;request_status:string|null;requested_at:Date|null;available_after:Date|null}
export class SessionTimingService {
 constructor(private repo:PlatformRepository){}
 private async lock(m:EntityManager,roleId:string){const first=requireValue(await m.getRepository(RoleEntity).findOneBy({id:roleId}));const session=requireValue(await m.getRepository(SessionEntity).findOne({where:{id:first.sessionId},lock:{mode:'pessimistic_write'}}));const role=requireValue(await m.getRepository(RoleEntity).findOne({where:{id:roleId},lock:{mode:'pessimistic_write'}}));return {session,role};}
 async detail(accountId:string,sessionId:string,now=new Date()){
   const {session,order}=await this.repo.authorizedSession(sessionId,accountId);
   const roles=await this.repo.db.query(`SELECT r.id AS role_id,c.name,r.status,r.checked_in_at,r.actual_started_at,r.actual_completed_at,coalesce(r.service_end_at,s.end_at) AS service_end_at,r.late,r.overrun_conflict,
    q.id AS request_id,q.status AS request_status,q.requested_at,q.available_after
    FROM roles r JOIN sessions s ON s.id=r.session_id LEFT JOIN creators c ON c.id=r.creator_id
    LEFT JOIN LATERAL(SELECT * FROM completion_requests WHERE role_id=r.id ORDER BY requested_at DESC,id DESC LIMIT 1) q ON true
    WHERE r.session_id=$1 AND r.creator_id IS NOT NULL AND r.status NOT IN ('cancelled','refunded') ORDER BY r.id`,[sessionId]) as Timing[];
   const [credit]=await this.repo.db.query('SELECT amount_paise FROM customer_credits WHERE reference=$1',[`late-arrival:${sessionId}`]);
   return {serverTime:now,customer:order.customerId===accountId,venueAllowsOverrun:session.venueAllowsOverrun,bookedEnd:new Date(session.startAt.getTime()+session.input.hours*3600000),lateCreditPaise:credit?.amount_paise??0,roles};
 }
 async arrival(m:EntityManager,session:Session,role:Role,when:Date,actor:string){
   const minutes=(when.getTime()-session.startAt.getTime())/60000;
   if(minutes>=30)throw new AppError(409,'NO_SHOW_WINDOW','Arrival is 30 minutes past the start. Contact operations for the replacement plan.');
   const late=minutes>10,bookedEnd=session.startAt.getTime()+session.input.hours*3600000;
   const end=new Date(session.venueAllowsOverrun?Math.max(session.startAt.getTime(),when.getTime())+session.input.hours*3600000:bookedEnd);
   await m.query('SELECT id FROM creators WHERE id=$1 FOR UPDATE',[role.creatorId]);
   await m.query('UPDATE roles SET checked_in_at=$2,service_end_at=$3,late=$4 WHERE id=$1',[role.id,when,end,late]);
   await this.reserve(m,role,end);
   await m.query('UPDATE sessions SET end_at=greatest(end_at,$2) WHERE id=$1',[session.id,end]);
   if(late){
     const credit=Math.round(session.totalPaise/10),order=await this.repo.order(session.orderId,m);
     if(credit>0){const rows=await m.query('INSERT INTO customer_credits(customer_id,session_id,reference,amount_paise) VALUES($1,$2,$3,$4) ON CONFLICT(reference) DO NOTHING RETURNING id',[order.customerId,session.id,`late-arrival:${session.id}`,credit]);if(rows.length)await this.repo.ledger(m,`late-credit:${session.id}`,order.id,[{account:'service_recovery_cost',amountPaise:credit},{account:'customer_credit_liability',amountPaise:-credit}]);}
     await this.repo.audit(m,actor,'creator_late_arrival',role.id,{minutesLate:Math.round(minutes),strike:'late',creditPolicy:'demo-10-percent-per-session'});
     await this.repo.event(m,'late_arrival',role.id,{sessionId:session.id,minutesLate:Math.round(minutes),creditPaise:credit});
   }
 }
 private async reserve(m:EntityManager,role:Role,end:Date){
   const reservedEnd=new Date(end.getTime()+30*60000);
   const conflicts=await m.query(`SELECT id FROM role_occupancy WHERE creator_id=$1 AND id<>$2 AND status NOT IN ('cancelled','refunded') AND tstzrange(reserved_start,occupied_until,'[)') && tstzrange($3,$4,'[)')
     UNION ALL SELECT id FROM availability WHERE creator_id=$1 AND NOT available AND tstzrange(start_at,end_at,'[)') && tstzrange($3,$4,'[)')`,[role.creatorId,role.id,role.reservedStart,reservedEnd]);
   if(conflicts.length){await m.query('UPDATE roles SET overrun_conflict=true WHERE id=$1',[role.id]);await this.repo.event(m,'overrun_conflict',role.id,{sessionId:role.sessionId,conflictIds:conflicts.map((r:{id:string})=>r.id)});}
   else await m.getRepository(RoleEntity).update(role.id,{reservedEnd,overrunConflict:false});
 }
 async venue(accountId:string,sessionId:string,body:unknown){
   const b=z.object({allowOverrun:z.boolean()}).parse(body);
   return this.repo.db.transaction(async m=>{
     const s=requireValue(await m.getRepository(SessionEntity).findOne({where:{id:sessionId},lock:{mode:'pessimistic_write'}}));await this.repo.ownedOrder(s.orderId,accountId,m);
     if(!['arrived','in_session'].includes(s.status))throw new AppError(409,'VENUE_WINDOW','Set venue timing during arrival or the active shoot');
     const roles=(await m.getRepository(RoleEntity).findBy({sessionId})).filter(r=>!['cancelled','refunded'].includes(r.status));
     const [pending]=await m.query("SELECT id FROM completion_requests WHERE role_id=ANY($1::uuid[]) AND status IN ('pending','disputed')",[roles.map(r=>r.id)]);if(pending)throw new AppError(409,'COMPLETION_PENDING','Resolve the pending completion first');
     await m.query('SELECT id FROM creators WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[roles.map(r=>r.creatorId).filter(Boolean)]);
     const bookedEnd=s.startAt.getTime()+s.input.hours*3600000;let latest=bookedEnd;
     for(const role of roles){if(role.actualCompletedAt){latest=Math.max(latest,role.serviceEndAt?.getTime()??bookedEnd);continue;}if(!role.creatorId)continue;await m.query('SELECT id FROM creators WHERE id=$1 FOR UPDATE',[role.creatorId]);const end=new Date(b.allowOverrun?Math.max(s.startAt.getTime(),role.checkedInAt?.getTime()??s.startAt.getTime())+s.input.hours*3600000:bookedEnd);latest=Math.max(latest,end.getTime());await m.getRepository(RoleEntity).update(role.id,{serviceEndAt:end});await this.reserve(m,role,end);}
     await m.getRepository(SessionEntity).update(s.id,{venueAllowsOverrun:b.allowOverrun,endAt:new Date(latest)});await this.repo.audit(m,accountId,'venue_overrun_preference',sessionId,b);return {updated:true};
   });
 }
 async request(accountId:string,roleId:string,body:unknown,now=new Date()){
   const b=z.object({clientId:z.uuid(),location:locationSchema}).parse(body);
   return this.repo.db.transaction(async m=>{
     const {session,role}=await this.lock(m,roleId),creator=await this.repo.creator(accountId,m);if(role.creatorId!==creator.id)throw new AppError(404,'NOT_FOUND','Shoot not found');
     const [prior]=await m.query('SELECT * FROM completion_requests WHERE actor_id=$1 AND client_id=$2',[accountId,b.clientId]);if(prior){if(prior.role_id!==roleId)throw new AppError(409,'EVENT_REUSED','This request identifier was used on another shoot');return prior;}
     const [open]=await m.query("SELECT * FROM completion_requests WHERE role_id=$1 AND status IN ('pending','disputed')",[roleId]);if(open)return open;
     if(role.status!=='in_session')throw new AppError(409,'COMPLETION_STATE','Start the session before requesting completion');
     if((role.serviceEndAt??session.endAt)>now)throw new AppError(422,'FULL_DURATION_REQUIRED','Provide the full agreed shooting time before using the customer-unavailable option');
     if(distanceMetres(b.location,session.input.venue)+b.location.accuracy>200)throw new AppError(422,'OUTSIDE_GEOFENCE','Check out within 200 metres of the venue');
     const [record]=await m.query('INSERT INTO completion_requests(role_id,actor_id,client_id,requested_at,available_after,location) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[roleId,accountId,b.clientId,now,new Date(now.getTime()+3600000),JSON.stringify(b.location)]);
     await this.repo.audit(m,accountId,'completion_requested',roleId,{requestId:record.id});await this.repo.event(m,'completion_requested',roleId,{requestId:record.id});return record;
   });
 }
 async complete(m:EntityManager,role:Role,when:Date,method:string,actor:string|null){
   const [checkout]=await m.query("SELECT requested_at FROM completion_requests WHERE role_id=$1 AND status IN ('pending','disputed')",[role.id]);
   await m.getRepository(RoleEntity).update(role.id,{status:'session_completed',actualCompletedAt:checkout?.requested_at??when});
   await m.query("UPDATE completion_requests SET status=$2,resolved_at=$3,reviewed_by=$4 WHERE role_id=$1 AND status IN ('pending','disputed')",[role.id,method,when,actor]);
   await refreshSessionState(m,role.sessionId,when);
   await this.repo.audit(m,actor,'session_completion_confirmed',role.id,{method});await this.repo.event(m,'session_complete',role.sessionId);
 }
 async decide(accountId:string,requestId:string,body:unknown,now=new Date(),staff=false){
   const b=z.object({action:z.enum(['confirm','dispute','continue']),reason:z.string().trim().max(2000).default('')}).parse(body);
   return this.repo.db.transaction(async m=>{
     const first=requireValue((await m.query('SELECT * FROM completion_requests WHERE id=$1',[requestId]))[0]),{session,role}=await this.lock(m,first.role_id);
     if(!staff)await this.repo.ownedOrder(session.orderId,accountId,m);
     if((b.action==='continue'&&!staff)||(b.action==='dispute'&&staff))throw new AppError(403,'DECISION_ROLE','This action is not available to your account');
     const q=requireValue((await m.query('SELECT * FROM completion_requests WHERE id=$1 FOR UPDATE',[requestId]))[0]);
     if(!['pending','disputed'].includes(q.status))return {status:q.status};
     if(role.status!=='in_session')throw new AppError(409,'COMPLETION_STATE','The session has already changed');
     if(b.action==='dispute'||staff){if(b.reason.length<5)throw new AppError(422,'REASON_REQUIRED','Add a brief explanation for the review');}
     if(b.action==='confirm')await this.complete(m,role,now,staff?'staff_completed':'confirmed',accountId);
     else{await m.query('UPDATE completion_requests SET status=$2,reason=$3,reviewed_by=$4,resolved_at=$5 WHERE id=$1',[q.id,b.action==='dispute'?'disputed':'dismissed',b.reason,accountId,b.action==='continue'?now:null]);await this.repo.event(m,b.action==='dispute'?'completion_disputed':'completion_reopened',role.id,{requestId:q.id});}
     await this.repo.audit(m,accountId,`completion_${b.action}`,role.id,{requestId:q.id,reason:b.reason,staff});return {updated:true};
   });
 }
 async closeDue(now=new Date()){
   const rows=await this.repo.db.query("SELECT id,role_id FROM completion_requests WHERE status='pending' AND available_after<=$1 ORDER BY available_after LIMIT 100",[now]);
   for(const row of rows)await this.repo.db.transaction(async m=>{const {role}=await this.lock(m,row.role_id),[q]=await m.query('SELECT * FROM completion_requests WHERE id=$1 FOR UPDATE',[row.id]);if(q.status!=='pending'||q.available_after>now||role.status!=='in_session')return;await this.complete(m,role,now,'auto_completed',null);});
 }
 async conflicts(){return this.repo.db.query(`SELECT r.id,o.code,c.name,r.service_end_at,
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'code',no.code,'start',ns.start_at,'status',n.status)) FROM role_occupancy n JOIN sessions ns ON ns.id=n.session_id JOIN orders no ON no.id=ns.order_id WHERE n.creator_id=r.creator_id AND n.id<>r.id AND n.status IN ('assigned','reconfirmed') AND ns.start_at>now() AND tstzrange(n.reserved_start,n.occupied_until,'[)') && tstzrange(r.reserved_start,r.service_end_at+interval '30 minutes','[)')),'[]') AS next_jobs
   FROM roles r JOIN sessions s ON s.id=r.session_id JOIN orders o ON o.id=s.order_id JOIN creators c ON c.id=r.creator_id WHERE r.overrun_conflict AND r.status IN ('arrived','in_session') ORDER BY s.start_at LIMIT 100`);}
 async resolveConflict(actor:string,roleId:string,body:unknown,now=new Date()){
   const b=z.object({nextRoleId:z.uuid().optional(),reason:z.string().trim().min(5).max(1000)}).parse(body);
   return this.repo.db.transaction(async m=>{
     const {role}=await this.lock(m,roleId);if(!role.overrunConflict||!role.serviceEndAt||!['arrived','in_session'].includes(role.status))throw new AppError(409,'CONFLICT_CHANGED','Refresh this timing conflict');
     await m.query('SELECT id FROM creators WHERE id=$1 FOR UPDATE',[role.creatorId]);
     if(b.nextRoleId){
       const first=requireValue(await m.getRepository(RoleEntity).findOneBy({id:b.nextRoleId}));
       try{await m.query('SELECT id FROM sessions WHERE id=$1 FOR UPDATE NOWAIT',[first.sessionId]);}catch(e){if((e as {code?:string}).code==='55P03')throw new AppError(409,'BOOKING_BUSY','The next booking is changing. Refresh and retry.');throw e;}
       const next=requireValue(await m.getRepository(RoleEntity).findOne({where:{id:first.id},lock:{mode:'pessimistic_write'}})),s=await this.repo.session(next.sessionId,m);
       if(next.id===role.id||next.creatorId!==role.creatorId||!['assigned','reconfirmed'].includes(next.status)||s.startAt<=now||next.reservedStart>=new Date(role.serviceEndAt.getTime()+30*60000)||next.reservedEnd<=role.reservedStart)throw new AppError(409,'REASSIGNMENT_UNAVAILABLE','Only a conflicting future shoot that has not begun travel can be reassigned');
       await m.getRepository(RoleEntity).update(next.id,{creatorId:null,status:'confirmed'});await m.query('UPDATE roles SET assigned_at=NULL,dispatch_started_at=$2 WHERE id=$1',[next.id,now]);
       await m.query("UPDATE offers SET status='withdrawn' WHERE role_id=$1 AND status IN ('accepted','pending')",[next.id]);
       await m.query("INSERT INTO service_failures(session_id,role_id,kind,credit_paise) VALUES($1,$2,'capacity_reassignment',0) ON CONFLICT(role_id,kind) DO UPDATE SET status='pending'",[s.id,next.id]);
       await refreshSessionState(m,s.id,now);await this.repo.event(m,'creator_cancelled',s.id);await this.repo.event(m,'dispatch_requested',next.id);
       await this.repo.audit(m,actor,'overrun_reassignment',next.id,{fromRole:roleId,reason:b.reason});
     }
     await this.reserve(m,role,role.serviceEndAt);await this.repo.audit(m,actor,'timing_conflict_reviewed',role.id,{reason:b.reason});
     return {resolved:!(await m.getRepository(RoleEntity).findOneByOrFail({id:roleId})).overrunConflict};
   });
 }
 async queue(){return this.repo.db.query(`SELECT q.id,q.role_id,q.status,q.reason,q.requested_at,q.available_after,q.location,c.name,o.code FROM completion_requests q JOIN roles r ON r.id=q.role_id JOIN creators c ON c.id=r.creator_id JOIN sessions s ON s.id=r.session_id JOIN orders o ON o.id=s.order_id WHERE q.status IN ('pending','disputed') ORDER BY q.requested_at LIMIT 100`);}
}
