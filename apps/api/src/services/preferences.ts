import {z} from 'zod';
import type {EntityManager} from 'typeorm';
import {unmetPreferences} from '@kamraw/domain';
import {CreatorEntity,SessionEntity,type Creator,type Role,type Session} from '../entities';
import {AppError,requireValue} from '../middleware/errors';
import {PlatformRepository} from '../repositories/platform';

export async function pendingPreferences(m:EntityManager,sessionId:string):Promise<boolean>{
 const [row]=await m.query(`SELECT EXISTS(SELECT 1 FROM preference_reviews p JOIN roles r ON r.id=p.role_id
 WHERE r.session_id=$1 AND r.creator_id=p.creator_id AND r.status NOT IN ('cancelled','refunded')
 AND p.accepted_at IS NULL AND jsonb_array_length(p.unmet)>0) AS pending`,[sessionId]);return row.pending;
}
export class PreferenceService {
 constructor(private repo:PlatformRepository){}
 async recordAssignment(m:EntityManager,session:Session,role:Role,creator:Creator){
  const unmet=unmetPreferences(session.input.preferences,{languages:creator.languages,gender:creator.profile.gender});
  const [review]=await m.query(`INSERT INTO preference_reviews(role_id,creator_id,unmet) VALUES($1,$2,$3)
   ON CONFLICT(role_id) DO UPDATE SET id=gen_random_uuid(),creator_id=EXCLUDED.creator_id,unmet=EXCLUDED.unmet,accepted_at=NULL,created_at=now() RETURNING id`,[role.id,creator.id,JSON.stringify(unmet)]);
  if(unmet.length)await this.repo.event(m,'preferences_unmet',session.id,{reviewId:review.id,roleId:role.id,unmet});
 }
 async detail(accountId:string,sessionId:string){
  const {session,order}=await this.repo.authorizedSession(sessionId,accountId);
  const roles=await this.repo.db.query(`SELECT p.id AS "reviewId",r.id AS "roleId",split_part(c.name,' ',1) AS name,r.discipline,r.tier,p.unmet,p.accepted_at AS "acceptedAt"
    FROM roles r JOIN creators c ON c.id=r.creator_id JOIN preference_reviews p ON p.role_id=r.id AND p.creator_id=r.creator_id
    WHERE r.session_id=$1 AND r.status NOT IN ('cancelled','refunded') ORDER BY r.id`,[sessionId]);
  const pending=await pendingPreferences(this.repo.db.manager,sessionId);
  return {status:session.status,customer:order.customerId===accountId,preferences:session.input.preferences,roles,canCancelFree:pending&&['confirmed','assigned','reconfirmed','en_route','arrived'].includes(session.status)};
 }
 async accept(accountId:string,sessionId:string,body:unknown,now=new Date()){
  const {reviewIds}=z.object({reviewIds:z.array(z.uuid()).min(1).max(50).refine(ids=>new Set(ids).size===ids.length)}).parse(body);
  return this.repo.db.transaction(async m=>{
   const session=requireValue(await m.getRepository(SessionEntity).findOne({where:{id:sessionId},lock:{mode:'pessimistic_write'}}));await this.repo.ownedOrder(session.orderId,accountId,m);
   if(!['confirmed','assigned','reconfirmed','en_route','arrived'].includes(session.status))throw new AppError(409,'REVIEW_UNAVAILABLE','This session no longer needs a preference decision.');
   const current=await m.query(`SELECT p.id,p.accepted_at FROM preference_reviews p JOIN roles r ON r.id=p.role_id
    WHERE r.session_id=$1 AND r.creator_id=p.creator_id AND r.status NOT IN ('cancelled','refunded') AND jsonb_array_length(p.unmet)>0`,[sessionId]) as {id:string;accepted_at:Date|null}[];
   if(reviewIds.some(id=>!current.some(r=>r.id===id))||current.some(r=>!r.accepted_at&&!reviewIds.includes(r.id)))throw new AppError(409,'PREFERENCES_CHANGED','Your assigned creators changed. Refresh and review the current preferences.');
   if(current.every(r=>r.accepted_at))return {accepted:true};
   await m.query('UPDATE preference_reviews SET accepted_at=$2 WHERE id=ANY($1::uuid[]) AND accepted_at IS NULL',[reviewIds,now]);
   await this.repo.audit(m,accountId,'preferences_accepted',sessionId,{reviewIds});await this.repo.event(m,'preferences_accepted',sessionId);return {accepted:true};
  });
 }
 async profile(accountId:string){const c=await this.repo.creator(accountId);return {languages:c.languages,gender:c.profile.gender??null};}
 async updateProfile(accountId:string,body:unknown){
  const p=z.object({languages:z.array(z.enum(['ta','en','hi'])).min(1).max(3).refine(l=>new Set(l).size===l.length),gender:z.enum(['female','male','non_binary']).nullable()}).parse(body);
  await this.repo.db.transaction(async m=>{const c=await this.repo.creator(accountId,m);await m.getRepository(CreatorEntity).findOne({where:{id:c.id},lock:{mode:'pessimistic_write'}});
   await m.query("UPDATE creators SET languages=$2,profile=jsonb_set(profile,'{gender}',$3::jsonb) WHERE id=$1",[c.id,JSON.stringify(p.languages),JSON.stringify(p.gender)]);
   await this.repo.audit(m,accountId,'matching_profile_updated',c.id);
  });return p;
 }
}
