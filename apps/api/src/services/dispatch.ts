import {dispatchScore,eligibleCandidates,type Candidate} from '@kamraw/domain';
import {z} from 'zod';
import type {EntityManager} from 'typeorm';
import {CreatorEntity,OfferEntity,RoleEntity,SessionEntity,type Role,type Session} from '../entities';
import {AppError,requireValue} from '../middleware/errors';
import {PlatformRepository} from '../repositories/platform';
export class DispatchService {
  constructor(private repo:PlatformRepository){}
  private async candidates(m:EntityManager,role:Role,session:Session,customerId:string,seen=new Set<string>()){
      const candidates=await m.getRepository(CreatorEntity).findBy({status:'active'});
      const pool:Candidate[]=[];
      for(const c of candidates.filter(c=>!seen.has(c.id))){
        const conflicts=await m.query(`SELECT 1 FROM roles WHERE creator_id=$1 AND status NOT IN ('cancelled','refunded') AND tstzrange(reserved_start,reserved_end,'[)') && tstzrange($2,$3,'[)') UNION ALL SELECT 1 FROM availability WHERE creator_id=$1 AND NOT available AND tstzrange(start_at,end_at,'[)') && tstzrange($2,$3,'[)')`,[c.id,role.reservedStart,role.reservedEnd]);
        const blocked=await m.query('SELECT 1 FROM customer_blocks WHERE customer_id=$1 AND creator_id=$2',[customerId,c.id]);
        pool.push({id:c.id,disciplines:c.disciplines,active:c.status==='active',online:c.online,zoneIds:c.zoneIds,rating:c.metrics.rating??5,reliability:c.metrics.reliability??1,qc:c.metrics.qc??1,recentJobs:c.metrics.recentJobs??0,acceptance:c.metrics.acceptance??1,etaMinutes:c.metrics.etaMinutes??80,nextProximity:c.metrics.nextProximity??0,blocked:blocked.length>0,available:conflicts.length===0});
      }
      return eligibleCandidates(pool,role,session.input.mode,session.zoneId);
  }
  async board(){return this.repo.db.query("SELECT r.id,r.discipline,r.tier,r.status,r.earning_paise,s.start_at,o.code FROM roles r JOIN sessions s ON s.id=r.session_id JOIN orders o ON o.id=s.order_id WHERE r.status='confirmed' AND r.creator_id IS NULL ORDER BY s.start_at LIMIT 100");}
  async manualCandidates(roleId:string){const role=requireValue(await this.repo.db.getRepository(RoleEntity).findOneBy({id:roleId})),session=await this.repo.session(role.sessionId),order=await this.repo.order(session.orderId);const rows=await this.repo.db.query('SELECT creator_id FROM creator_cancellations WHERE role_id=$1',[roleId]);const pool=await this.candidates(this.repo.db.manager,role,session,order.customerId,new Set(rows.map((r:{creator_id:string})=>r.creator_id)));return Promise.all(pool.map(async c=>({id:c.id,name:(await this.repo.db.getRepository(CreatorEntity).findOneByOrFail({id:c.id})).name,score:dispatchScore(c),etaMinutes:c.etaMinutes})));}
  async manualOffer(actor:string,roleId:string,body:unknown,now=new Date()){
    const b=z.object({creatorId:z.uuid(),reason:z.string().trim().min(5).max(1000)}).parse(body);
    return this.repo.db.transaction(async m=>{const role=requireValue(await m.getRepository(RoleEntity).findOne({where:{id:roleId},lock:{mode:'pessimistic_write'}}));if(role.status!=='confirmed'||role.creatorId)throw new AppError(409,'ROLE_ASSIGNED','This role is already assigned');const session=await this.repo.session(role.sessionId,m),order=await this.repo.order(session.orderId,m);const cancelled=await m.query('SELECT 1 FROM creator_cancellations WHERE role_id=$1 AND creator_id=$2',[roleId,b.creatorId]);if(cancelled.length)throw new AppError(409,'CREATOR_CANCELLED','Choose another creator after a cancellation');const candidate=(await this.candidates(m,role,session,order.customerId)).find(c=>c.id===b.creatorId);if(!candidate)throw new AppError(409,'INELIGIBLE','This creator is unavailable or does not meet the role requirements');await m.query("UPDATE offers SET status='withdrawn' WHERE role_id=$1 AND status='pending'",[roleId]);const previous=await m.getRepository(OfferEntity).findOneBy({roleId,creatorId:b.creatorId});const offer=await m.getRepository(OfferEntity).save({...previous,roleId,creatorId:b.creatorId,status:'pending',score:dispatchScore(candidate),earningPaise:role.earningPaise,expiresAt:new Date(now.getTime()+(session.input.mode==='on_demand'?60000:900000))});await this.repo.audit(m,actor,'manual_offer_sent',roleId,{creatorId:b.creatorId,reason:b.reason});await this.repo.event(m,'offer_sent',offer.id);return offer;});
  }
  async dispatch(roleId:string,now=new Date()){
    return this.repo.db.transaction(async m=>{
      const role=requireValue(await m.getRepository(RoleEntity).findOne({where:{id:roleId},lock:{mode:'pessimistic_write'}}));if(role.creatorId||role.status!=='confirmed')return [];
      const session=await this.repo.session(role.sessionId,m),order=await this.repo.order(session.orderId,m);
      await m.query("UPDATE offers SET status='expired' WHERE role_id=$1 AND status='pending' AND expires_at<=$2",[roleId,now]);
      if(await m.getRepository(OfferEntity).countBy({roleId,status:'pending'}))return [];
      const offered=await m.getRepository(OfferEntity).findBy({roleId});const eligible=await this.candidates(m,role,session,order.customerId,new Set(offered.map(o=>o.creatorId))),count=session.input.mode==='on_demand'?3:1,ttl=session.input.mode==='on_demand'?60000:900000;
      const offers=[];
      for(const c of eligible.slice(0,count)){const offer=await m.getRepository(OfferEntity).save({roleId,creatorId:c.id,status:'pending',score:dispatchScore(c),earningPaise:role.earningPaise,expiresAt:new Date(now.getTime()+ttl)});offers.push(offer);await this.repo.event(m,'offer_sent',offer.id,{creatorId:c.id});}
      if(!offers.length){const [alert]=await m.query("SELECT id FROM outbox WHERE kind='manual_dispatch_required' AND entity_id=$1",[roleId]);if(!alert)await this.repo.event(m,'manual_dispatch_required',roleId);}
      return offers;
    });
  }
  async accept(accountId:string,offerId:string,now=new Date()){
    return this.repo.db.transaction(async m=>{
      const creator=await this.repo.creator(accountId,m);const initialOffer=requireValue(await m.getRepository(OfferEntity).findOneBy({id:offerId,creatorId:creator.id}));
      const initial=requireValue(await m.getRepository(RoleEntity).findOneBy({id:initialOffer.roleId}));await m.getRepository(SessionEntity).findOne({where:{id:initial.sessionId},lock:{mode:'pessimistic_write'}});
      const role=requireValue(await m.getRepository(RoleEntity).findOne({where:{id:initialOffer.roleId},lock:{mode:'pessimistic_write'}}));
      const offer=requireValue(await m.getRepository(OfferEntity).findOneBy({id:offerId,creatorId:creator.id}));
      if(role.creatorId===creator.id&&offer.status==='accepted')return role;
      if(role.status!=='confirmed'||role.creatorId||offer.status!=='pending'||offer.expiresAt<=now)throw new AppError(409,'OFFER_UNAVAILABLE','This offer has expired or another creator accepted it');
      await m.getRepository(CreatorEntity).findOne({where:{id:creator.id},lock:{mode:'pessimistic_write'}});
      const session=await this.repo.session(role.sessionId,m),order=await this.repo.order(session.orderId,m);if(!(await this.candidates(m,role,session,order.customerId)).some(c=>c.id===creator.id))throw new AppError(409,'UNAVAILABLE','Your availability or eligibility changed');
      const blocks=await m.query('SELECT 1 FROM availability WHERE creator_id=$1 AND NOT available AND tstzrange(start_at,end_at) && tstzrange($2,$3)',[creator.id,role.reservedStart,role.reservedEnd]);if(blocks.length)throw new AppError(409,'UNAVAILABLE','Your availability changed');
      await m.getRepository(RoleEntity).update(role.id,{creatorId:creator.id,status:'assigned'});
      await m.query("UPDATE offers SET status=CASE WHEN id=$1 THEN 'accepted' ELSE 'withdrawn' END WHERE role_id=$2 AND status='pending'",[offerId,role.id]);
      const open=await m.getRepository(RoleEntity).countBy({sessionId:role.sessionId,status:'confirmed'});if(!open)await m.getRepository(SessionEntity).update(role.sessionId,{status:'assigned'});
      await this.repo.audit(m,accountId,'offer_accepted',role.id,{offerId,score:offer.score});await this.repo.event(m,'creator_assigned',role.sessionId);return {...role,creatorId:creator.id,status:'assigned'};
    });
  }
  async decline(accountId:string,offerId:string){const c=await this.repo.creator(accountId);const [rows]=await this.repo.db.query("UPDATE offers SET status='declined' WHERE id=$1 AND creator_id=$2 AND status='pending' RETURNING role_id",[offerId,c.id]);if(!rows.length)throw new AppError(409,'OFFER_UNAVAILABLE','This offer is no longer available');await this.dispatch(rows[0].role_id);return {declined:true};}
  async offers(accountId:string){const creator=await this.repo.creator(accountId);return this.repo.db.query(`SELECT o.*,s.start_at,s.end_at,s.zone_id,s.input->>'mode' AS mode,r.discipline,r.tier,ord.category FROM offers o JOIN roles r ON r.id=o.role_id JOIN sessions s ON s.id=r.session_id JOIN orders ord ON ord.id=s.order_id WHERE o.creator_id=$1 AND o.status='pending' AND o.expires_at>now() ORDER BY o.expires_at`,[creator.id]);}
  async jobs(accountId:string){const creator=await this.repo.creator(accountId);return this.repo.db.query(`SELECT s.id,jsonb_set(s.input,'{venue,contactPhone}','"Contact through in-app chat"') AS input,s.start_at,s.end_at,r.status,s.status AS session_status,r.id AS role_id,r.earning_paise,r.discipline,r.tier,o.code FROM roles r JOIN sessions s ON s.id=r.session_id JOIN orders o ON o.id=s.order_id WHERE r.creator_id=$1 ORDER BY s.start_at DESC LIMIT 100`,[creator.id]);}
}
