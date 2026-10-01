import {z} from 'zod';
import {pendingPreferences} from './preferences';
import {SessionTimingService} from './session-timing';
import {refreshSessionState} from './session-state';
import {assertTransition,distanceMetres,pointSchema,type Status} from '@kamraw/domain';
import {RoleEntity,SessionEntity} from '../entities';
import {AppError,requireValue} from '../middleware/errors';
import {PlatformRepository} from '../repositories/platform';
const eventSchema=z.object({clientId:z.uuid(),action:z.enum(['reconfirm','trip','check_in','start','complete']),deviceAt:z.iso.datetime({offset:true}),location:pointSchema.extend({accuracy:z.number().min(0).max(100)}),completionCode:z.string().length(6).optional(),identityProof:z.string().min(1).max(500).optional()});
const stateByAction:Record<string,Status>={reconfirm:'reconfirmed',trip:'en_route',check_in:'arrived',start:'in_session',complete:'session_completed'};
export class SessionService {
  constructor(private repo:PlatformRepository,private demo:boolean){}
  async transition(accountId:string,roleId:string,body:unknown,now=new Date()){
    const e=eventSchema.parse(body),when=new Date(e.deviceAt);if(Math.abs(now.getTime()-when.getTime())>24*3600000||when.getTime()>now.getTime()+60000)throw new AppError(422,'DEVICE_TIME','Device time is outside the accepted sync window');
    return this.repo.db.transaction(async m=>{
      const creator=await this.repo.creator(accountId,m),initial=requireValue(await m.getRepository(RoleEntity).findOneBy({id:roleId,creatorId:creator.id}));await m.getRepository(SessionEntity).findOne({where:{id:initial.sessionId},lock:{mode:'pessimistic_write'}});const role=requireValue(await m.getRepository(RoleEntity).findOne({where:{id:roleId,creatorId:creator.id},lock:{mode:'pessimistic_write'}}));
      const session=requireValue(await m.getRepository(SessionEntity).createQueryBuilder('s').addSelect('s.completionCode').where('s.id=:id',{id:role.sessionId}).setLock('pessimistic_write').getOne());
      const prior=await m.query('SELECT kind,session_id FROM session_events WHERE actor_id=$1 AND client_id=$2',[accountId,e.clientId]) as {kind:string;session_id:string}[];if(prior.length){if(prior[0]!.kind!==e.action||prior[0]!.session_id!==session.id)throw new AppError(409,'EVENT_REUSED','Event identifier has already been used');return {status:role.status,synced:true};}
      const [last]=await m.query("SELECT max(device_at) AS at FROM session_events WHERE actor_id=$1 AND session_id=$2 AND payload->>'roleId'=$3",[accountId,session.id,roleId]);if(last.at&&when<new Date(last.at))throw new AppError(422,'EVENT_ORDER','Event time is before the previous step');
      const timing=new SessionTimingService(this.repo);
      const next=stateByAction[e.action]!;try{assertTransition(role.status,next);}catch(err){throw new AppError(409,'INVALID_TRANSITION',(err as Error).message);}
      if(e.action==='trip'&&await pendingPreferences(m,session.id))throw new AppError(409,'PREFERENCE_REVIEW_REQUIRED','Wait for the customer to review the unmatched preferences before starting the trip.');
      if(e.action==='trip'){const [decision]=await m.query(`SELECT max(p.accepted_at) AS at FROM preference_reviews p JOIN roles r ON r.id=p.role_id WHERE r.session_id=$1 AND r.creator_id=p.creator_id AND r.status NOT IN ('cancelled','refunded')`,[session.id]);if(decision.at&&when<new Date(decision.at))throw new AppError(409,'PREFERENCE_DECISION_TIME','Start the trip after the customer has reviewed the unmatched preferences.');}
      if(e.action==='check_in'){
        const distance=distanceMetres(e.location,session.input.venue);if(distance+e.location.accuracy>200)throw new AppError(422,'OUTSIDE_GEOFENCE',`Move closer to the venue (${Math.round(distance)} metres away)`);
        if(!this.demo)throw new AppError(503,'IDENTITY_PROVIDER_REQUIRED','Live face verification is not configured');
        if(e.identityProof!=='demo-selfie')throw new AppError(422,'SELFIE_REQUIRED','Complete the demo identity check first');
        await timing.arrival(m,session,role,when,accountId);
      }
      if(e.action==='start'&&when<session.startAt)throw new AppError(422,'TOO_EARLY','The session cannot start before the booked time');
      if(e.action==='complete'&&e.completionCode!==session.completionCode)throw new AppError(422,'INVALID_CODE','Ask the customer for the correct completion code');
      if(e.action==='complete')await timing.complete(m,role,when,'confirmed',accountId);
      else{await m.getRepository(RoleEntity).update(roleId,{status:next,...(e.action==='start'?{actualStartedAt:when}:{})});await refreshSessionState(m,session.id,when);}
      await m.query('INSERT INTO session_events(session_id,actor_id,client_id,kind,payload,device_at) VALUES($1,$2,$3,$4,$5,$6)',[session.id,accountId,e.clientId,e.action,JSON.stringify({location:e.location,roleId,identityMethod:e.action==='check_in'?'demo':undefined}),when]);
      await this.repo.audit(m,accountId,`session_${e.action}`,session.id);if(e.action!=='complete')await this.repo.event(m,`session_${e.action}`,session.id);return {status:next,synced:true};
    });
  }
  async location(accountId:string,sessionId:string,body:unknown){const p=pointSchema.extend({accuracy:z.number().min(0).max(1000)}).parse(body),c=await this.repo.creator(accountId);const role=await this.repo.db.getRepository(RoleEntity).findOneBy({sessionId,creatorId:c.id,status:'en_route'});if(!role)throw new AppError(409,'TRACKING_INACTIVE','Location is collected only during an active trip');await this.repo.db.query('INSERT INTO locations(session_id,creator_id,lat,lng,accuracy) VALUES($1,$2,$3,$4,$5)',[sessionId,c.id,p.lat,p.lng,p.accuracy]);return {recorded:true};}
}
