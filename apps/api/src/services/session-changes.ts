import {splitRefund,returnCredit} from './credits';
import {z} from 'zod';
import {pointInPolygon,quotePrice,sessionSchema,validateSessionTime,type SessionInput} from '@kamraw/domain';
import {EntityManager} from 'typeorm';
import {RoleEntity,SessionEntity,type Role,type Session} from '../entities';
import {AppError,requireValue} from '../middleware/errors';
import {PlatformRepository} from '../repositories/platform';
interface ChangeData {input:SessionInput;previousStart:string;previousEnd:string;totalPaise:number;zoneId:string;roles:{id:string;creatorId:string|null;earningPaise:number}[]}
interface Change {id:string;session_id:string;customer_id:string;kind:'reschedule'|'extension';status:string;data:ChangeData;delta_paise:number;expires_at:Date}
export class SessionChangeService {
  constructor(private repo:PlatformRepository){}
  private async lockedSession(m:EntityManager,id:string){return requireValue(await m.getRepository(SessionEntity).findOne({where:{id},lock:{mode:'pessimistic_write'}}));}
  private async currentRoles(m:EntityManager,id:string){return m.getRepository(RoleEntity).createQueryBuilder('r').where('r.sessionId=:id',{id}).andWhere("r.status NOT IN ('cancelled','refunded')").orderBy('r.id').getMany();}
  private reschedulable(s:Session,now:Date){if(!['confirmed','assigned','reconfirmed'].includes(s.status)||s.startAt.getTime()-now.getTime()<=72*3600000)throw new AppError(409,'RESCHEDULE_WINDOW','One free reschedule is available more than 72 hours before the shoot. Contact support for other changes.');}
  private async conflicts(m:EntityManager,roles:Role[],end:Date){for(const r of roles){if(!r.creatorId)throw new AppError(409,'CREATOR_REQUIRED','Every creator must be assigned before extending');const rows=await m.query(`SELECT 1 FROM roles WHERE creator_id=$1 AND id<>$2 AND status NOT IN ('cancelled','refunded') AND tstzrange(reserved_start,reserved_end,'[)') && tstzrange($3,$4,'[)') UNION ALL SELECT 1 FROM availability WHERE creator_id=$1 AND NOT available AND tstzrange(start_at,end_at,'[)') && tstzrange($3,$4,'[)')`,[r.creatorId,r.id,r.reservedStart,new Date(end.getTime()+30*60000)]);if(rows.length)throw new AppError(409,'EXTENSION_CONFLICT','A creator has another commitment. Choose a shorter extension or keep your booked time.');}}
  private async rescheduleSupply(m:EntityManager,s:Session,input:SessionInput,customerId:string){
    const {zones}=await this.repo.config(m),zone=zones.find(z=>z.active&&pointInPolygon(input.venue,z.polygon));if(!zone)throw new AppError(409,'ZONE_PAUSED','This venue is no longer in an active zone');
    const grouped=new Map<string,number>();for(const r of input.roles)grouped.set(`${r.discipline}:${r.tier}`,(grouped.get(`${r.discipline}:${r.tier}`)??0)+r.count);
    const start=new Date(new Date(input.start).getTime()-80*60000),end=new Date(new Date(input.start).getTime()+input.hours*3600000+30*60000);
    for(const [key,needed] of grouped){const [discipline,tier]=key.split(':');const [row]=await m.query(`SELECT count(*)::int AS n FROM creators c WHERE c.status='active' AND c.disciplines->>$1=$2 AND c.zone_ids ? $3 AND NOT EXISTS(SELECT 1 FROM customer_blocks b WHERE b.customer_id=$4 AND b.creator_id=c.id) AND NOT EXISTS(SELECT 1 FROM roles r WHERE r.creator_id=c.id AND r.session_id<>$5 AND r.status NOT IN ('cancelled','refunded') AND tstzrange(r.reserved_start,r.reserved_end,'[)') && tstzrange($6,$7,'[)')) AND NOT EXISTS(SELECT 1 FROM availability a WHERE a.creator_id=c.id AND NOT a.available AND tstzrange(a.start_at,a.end_at,'[)') && tstzrange($6,$7,'[)'))`,[discipline,tier,zone.id,customerId,s.id,start,end]);if(row.n<needed)throw new AppError(409,'SUPPLY_UNAVAILABLE','Not enough creators are available at the new time. Your current booking is unchanged.');}
  }
  async list(accountId:string,sessionId:string){await this.repo.authorizedSession(sessionId,accountId);return this.repo.db.query(`SELECT c.*,coalesce((SELECT jsonb_agg(jsonb_build_object('roleId',r.role_id,'accepted',r.accepted)) FROM extension_responses r WHERE r.change_id=c.id),'[]') AS responses FROM session_changes c WHERE session_id=$1 ORDER BY created_at DESC LIMIT 50`,[sessionId]);}
  async request(customerId:string,sessionId:string,body:unknown,now=new Date()){
    const b=z.discriminatedUnion('kind',[z.object({kind:z.literal('reschedule'),start:z.iso.datetime({offset:true})}),z.object({kind:z.literal('extension'),blocks:z.number().int().min(1).max(4)})]).parse(body);
    return this.repo.db.transaction(async m=>{
      const s=await this.lockedSession(m,sessionId),order=await this.repo.ownedOrder(s.orderId,customerId,m),roles=await this.currentRoles(m,s.id),{rates,zones}=await this.repo.config(m);
      await m.query("UPDATE session_changes SET status='expired' WHERE session_id=$1 AND status='pending' AND expires_at<=$2",[s.id,now]);
      const [pending]=await m.query("SELECT id FROM session_changes WHERE session_id=$1 AND status='pending'",[s.id]);if(pending)throw new AppError(409,'CHANGE_PENDING','Review or dismiss your existing change first');
      let input=s.input,total=s.totalPaise,rolePrices:{id:string;creatorId:string|null;earningPaise:number}[],expires=new Date(now.getTime()+600000);
      if(b.kind==='reschedule'){
        this.reschedulable(s,now);const [prior]=await m.query("SELECT id FROM session_changes WHERE session_id=$1 AND kind='reschedule' AND status='applied'",[s.id]);if(prior)throw new AppError(409,'RESCHEDULE_USED','Your free reschedule has already been used. Contact support for another change.');
        input=sessionSchema.parse({...s.input,start:b.start});
        try{total=quotePrice({category:order.category as Parameters<typeof quotePrice>[0]['category'],sessions:[input],termsVersion:'demo-v1'},zones,rates,now).totalPaise;}catch(e){throw new AppError(422,'BOOKING_UNAVAILABLE',(e as Error).message);}
        await this.rescheduleSupply(m,s,input,customerId);
        rolePrices=roles.map(r=>({id:r.id,creatorId:r.creatorId,earningPaise:rates.rates[`${r.discipline}:${r.tier}`]!.earningHourPaise*input.hours}));
      }else{
        if(s.status!=='in_session'||s.endAt<=now||roles.some(r=>r.status!=='in_session'))throw new AppError(409,'EXTENSION_WINDOW','Extensions are available during the active shoot, before the booked end time.');
        const hours=b.blocks/2,end=new Date(s.endAt.getTime()+hours*3600000);await this.conflicts(m,roles,end);input={...s.input,hours:s.input.hours+hours};
        const base=roles.reduce((sum,r)=>sum+Math.round(rates.rates[`${r.discipline}:${r.tier}`]!.hourPaise*hours),0);total+=base+Math.round(base*rates.taxBps/10000);
        rolePrices=roles.map(r=>({id:r.id,creatorId:r.creatorId,earningPaise:Math.round(rates.rates[`${r.discipline}:${r.tier}`]!.earningHourPaise*hours)}));expires=new Date(Math.min(expires.getTime(),s.endAt.getTime()));
      }
      const data:ChangeData={input,previousStart:s.startAt.toISOString(),previousEnd:s.endAt.toISOString(),totalPaise:total,zoneId:zones.find(z=>z.active&&pointInPolygon(input.venue,z.polygon))!.id,roles:rolePrices};
      const [change]=await m.query('INSERT INTO session_changes(session_id,customer_id,kind,data,delta_paise,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[s.id,customerId,b.kind,JSON.stringify(data),total-s.totalPaise,expires]);
      await this.repo.audit(m,customerId,`${b.kind}_requested`,s.id,{changeId:change.id,deltaPaise:change.delta_paise});await this.repo.event(m,`${b.kind}_requested`,s.id,{changeId:change.id});return change;
    });
  }
  async dismiss(customerId:string,id:string){const [rows]=await this.repo.db.query("UPDATE session_changes SET status='dismissed' WHERE id=$1 AND customer_id=$2 AND status='pending' RETURNING id",[id,customerId]);if(!rows.length)throw new AppError(409,'CHANGE_UNAVAILABLE','This change is no longer pending');return {dismissed:true};}
  async respond(accountId:string,id:string,accepted:boolean,now=new Date()){
    return this.repo.db.transaction(async m=>{
      const c=await this.repo.creator(accountId,m),[change]=await m.query('SELECT * FROM session_changes WHERE id=$1 FOR UPDATE',[id]) as Change[];const x=requireValue(change);
      if(x.kind!=='extension'||x.status!=='pending'||x.expires_at<=now)throw new AppError(409,'CHANGE_UNAVAILABLE','This extension is no longer pending');
      const roles=(await this.currentRoles(m,x.session_id)).filter(r=>r.creatorId===c.id&&x.data.roles.some(saved=>saved.id===r.id&&saved.creatorId===c.id));if(!roles.length)throw new AppError(404,'NOT_FOUND','Extension not found');
      for(const role of roles)await m.query('INSERT INTO extension_responses(change_id,role_id,creator_id,accepted) VALUES($1,$2,$3,$4) ON CONFLICT(change_id,role_id) DO NOTHING',[id,role.id,c.id,accepted]);
      if(!accepted)await m.query("UPDATE session_changes SET status='declined' WHERE id=$1",[id]);await this.repo.audit(m,accountId,accepted?'extension_accepted':'extension_declined',id);return {accepted};
    });
  }
  async applyDemo(customerId:string,id:string,expectedDeltaPaise:number,now=new Date()){
    return this.repo.db.transaction(async m=>{
      const [found]=await m.query('SELECT * FROM session_changes WHERE id=$1 AND customer_id=$2',[id,customerId]) as Change[];const first=requireValue(found),s=await this.lockedSession(m,first.session_id);
      const [row]=await m.query('SELECT * FROM session_changes WHERE id=$1 FOR UPDATE',[id]) as Change[],x=requireValue(row);await this.repo.ownedOrder(s.orderId,customerId,m);
      if(x.status==='applied')return x;
      if(x.status!=='pending'||x.expires_at<=now)throw new AppError(409,'CHANGE_UNAVAILABLE','Refresh this change before continuing');
      if(x.delta_paise!==expectedDeltaPaise)throw new AppError(409,'PRICE_CHANGED','Review the change amount before confirming');
      if(x.data.previousStart!==s.startAt.toISOString()||x.data.previousEnd!==s.endAt.toISOString())throw new AppError(409,'SESSION_CHANGED','The booking changed. Request a fresh quote.');
      const roles=await this.currentRoles(m,s.id),start=new Date(x.data.input.start),end=new Date(start.getTime()+x.data.input.hours*3600000);
      if(x.kind==='reschedule'){
        this.reschedulable(s,now);const {zones}=await this.repo.config(m);const zone=requireValue(zones.find(z=>z.active&&pointInPolygon(x.data.input.venue,z.polygon)));try{validateSessionTime(x.data.input,now,zone.leadMinutes,zone.openHour,zone.closeHour);}catch(e){throw new AppError(409,'START_CHANGED',(e as Error).message);}
        await this.rescheduleSupply(m,s,x.data.input,customerId);const [used]=await m.query("SELECT id FROM session_changes WHERE session_id=$1 AND kind='reschedule' AND status='applied'",[s.id]);if(used)throw new AppError(409,'RESCHEDULE_USED','Your free reschedule has already been used');
        await m.query("UPDATE offers SET status='withdrawn' WHERE role_id IN (SELECT id FROM roles WHERE session_id=$1) AND status='pending'",[s.id]);await m.getRepository(RoleEntity).update({sessionId:s.id},{status:'cancelled'});
        for(const r of roles){const earning=requireValue(x.data.roles.find(p=>p.id===r.id));const next=await m.getRepository(RoleEntity).save({sessionId:s.id,discipline:r.discipline,tier:r.tier,status:'confirmed',earningPaise:earning.earningPaise,lead:r.lead,reservedStart:new Date(start.getTime()-80*60000),reservedEnd:new Date(end.getTime()+30*60000)});await this.repo.event(m,'dispatch_requested',next.id);}
      }else{
        if(s.status!=='in_session'||s.endAt<=now||roles.some(r=>r.status!=='in_session'))throw new AppError(409,'EXTENSION_WINDOW','This shoot is no longer available for extension');
        const responses=await m.query('SELECT role_id,creator_id FROM extension_responses WHERE change_id=$1 AND accepted',[x.id]) as {role_id:string;creator_id:string}[];
        if(roles.length!==x.data.roles.length||roles.some(r=>!responses.some(a=>a.role_id===r.id&&a.creator_id===r.creatorId)||!x.data.roles.some(p=>p.id===r.id&&p.creatorId===r.creatorId)))throw new AppError(409,'AWAITING_CREATORS','Every creator must accept before you pay for the extension');
        await this.conflicts(m,roles,end);for(const r of roles){const add=requireValue(x.data.roles.find(p=>p.id===r.id));await m.getRepository(RoleEntity).update(r.id,{reservedEnd:new Date(end.getTime()+30*60000),earningPaise:r.earningPaise+add.earningPaise});}
      }
      await m.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[s.orderId]);await m.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[customerId]);
      const creditRefund=x.delta_paise<0?splitRefund(-x.delta_paise,s.totalPaise,s.creditPaise).creditPaise:0;
      await returnCredit(m,customerId,s.id,`change:${x.id}`,creditRefund);
      await m.getRepository(SessionEntity).update(s.id,{creditPaise:s.creditPaise-creditRefund,input:x.data.input,startAt:start,endAt:end,totalPaise:x.data.totalPaise,zoneId:x.data.zoneId,...(x.kind==='reschedule'?{status:'confirmed' as const}:{})});
      await m.query('UPDATE orders SET total_paise=total_paise+$2 WHERE id=$1',[s.orderId,x.delta_paise]);
      if(x.delta_paise!==0)await this.repo.ledger(m,`demo-change:${x.id}`,s.orderId,[{account:'gateway_clearing',amountPaise:x.delta_paise+creditRefund},{account:'customer_credit_liability',amountPaise:-creditRefund},{account:'customer_deposits',amountPaise:-x.delta_paise}]);
      await m.query("UPDATE session_changes SET status='applied',applied_at=$2,credit_refund_paise=$3 WHERE id=$1",[x.id,now,creditRefund]);await this.repo.audit(m,customerId,`${x.kind}_applied`,s.id,{changeId:x.id,deltaPaise:x.delta_paise,settlement:'simulated'});await this.repo.event(m,`${x.kind}_applied`,s.id);return {...x,status:'applied',settlement:'simulated'};
    });
  }
}
