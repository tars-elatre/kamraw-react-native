import {z} from 'zod';
import {PlatformRepository} from '../repositories/platform';
import {AppError} from '../middleware/errors';
export const feedbackTags=['punctual','friendly','clear_communication','great_quality','needs_improvement','venue_ready','respectful','delivery_quality'] as const;
const schema=z.object({kind:z.enum(['creator','delivery','customer']),creatorId:z.uuid().optional(),stars:z.number().int().min(1).max(5),tags:z.array(z.enum(feedbackTags)).max(6).default([]),comment:z.string().trim().max(2000).default('')});
export class RatingService {
  constructor(private repo:PlatformRepository){}
  async list(accountId:string,sessionId:string,now=new Date()){
    const {session,order}=await this.repo.authorizedSession(sessionId,accountId);
    const [gallery]=await this.repo.db.query('SELECT final_delivered_at FROM galleries WHERE order_id=$1',[order.id]);
    const window=(start:Date|string|null)=>{const opensAt=start?new Date(start):null,closesAt=opensAt?new Date(opensAt.getTime()+7*86400000):null;return {opensAt,closesAt,open:!!(opensAt&&closesAt&&now>=opensAt&&now<=closesAt)};};
    return {ratings:await this.repo.db.query('SELECT id,kind,creator_id,stars,tags,comment,created_at FROM ratings WHERE session_id=$1 AND rater_id=$2',[sessionId,accountId]),windows:{session:window(session.completedAt),delivery:window(gallery?.final_delivered_at??null)}};
  }
  async rate(accountId:string,sessionId:string,body:unknown,now=new Date()){
    const input=schema.parse(body);
    return this.repo.db.transaction(async m=>{
      await m.query('SELECT id FROM sessions WHERE id=$1 FOR UPDATE',[sessionId]);
      const {session,order}=await this.repo.authorizedSession(sessionId,accountId,false,m),customer=order.customerId===accountId;
      if(customer===(input.kind==='customer'))throw new AppError(403,'RATING_ROLE','Choose the feedback type available to your account');
      let completed=session.completedAt;
      if(input.kind==='delivery'){const [gallery]=await m.query('SELECT final_delivered_at FROM galleries WHERE order_id=$1',[order.id]);completed=gallery?.final_delivered_at??null;}
      if(!completed||new Date(completed)>now||now.getTime()-new Date(completed).getTime()>7*86400000)throw new AppError(422,'RATING_WINDOW',input.kind==='delivery'?'Rate delivery within seven days of final delivery':'Rate within seven days of session completion');
      const creatorId=input.kind==='creator'?input.creatorId:null;
      if(input.kind==='creator'){
        if(!creatorId)throw new AppError(422,'CREATOR_REQUIRED','Choose the creator you are reviewing');
        const [role]=await m.query("SELECT id FROM roles WHERE session_id=$1 AND creator_id=$2 AND status NOT IN ('cancelled','refunded')",[sessionId,creatorId]);
        if(!role)throw new AppError(404,'NOT_FOUND','This creator was not assigned to your shoot');
      }
      if(creatorId)await m.query('SELECT id FROM creators WHERE id=$1 FOR UPDATE',[creatorId]);
      const tags=[...new Set(input.tags)].sort();
      const [prior]=await m.query('SELECT * FROM ratings WHERE session_id=$1 AND rater_id=$2 AND kind=$3 AND creator_id IS NOT DISTINCT FROM $4::uuid',[sessionId,accountId,input.kind,creatorId]);
      if(prior){if(prior.stars===input.stars&&prior.comment===input.comment&&JSON.stringify(prior.tags)===JSON.stringify(tags))return prior;throw new AppError(409,'ALREADY_RATED','You have already submitted this review');}
      const [rating]=await m.query('INSERT INTO ratings(session_id,rater_id,kind,creator_id,stars,tags,comment,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[sessionId,accountId,input.kind,creatorId,input.stars,JSON.stringify(tags),input.comment,now]);
      if(creatorId){
        const [average]=await m.query("SELECT avg(stars)::float AS value FROM (SELECT stars FROM ratings WHERE creator_id=$1 AND kind='creator' ORDER BY created_at DESC,id DESC LIMIT 20) recent",[creatorId]);
        await m.query("UPDATE creators SET metrics=metrics||jsonb_build_object('rating',$2::float) WHERE id=$1",[creatorId,average.value]);
        if(average.value<4.2)await this.repo.event(m,'creator_quality_review',creatorId,{ratingId:rating.id,average:average.value,review:average.value<4?'suspension_review':'improvement_review'});
      }
      await this.repo.audit(m,accountId,'rating_submitted',rating.id,{sessionId,kind:input.kind,creatorId});return rating;
    });
  }
}
