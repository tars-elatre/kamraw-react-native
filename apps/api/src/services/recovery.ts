import {z} from 'zod';
import {CreatorEntity,RoleEntity,SessionEntity} from '../entities';
import {PlatformRepository} from '../repositories/platform';
import {AppError,requireValue} from '../middleware/errors';
export class RecoveryService {
 constructor(private repo:PlatformRepository){}
 async preview(accountId:string,roleId:string,now=new Date()){
  const creator=await this.repo.creator(accountId),role=requireValue(await this.repo.db.getRepository(RoleEntity).findOneBy({id:roleId,creatorId:creator.id}));const session=await this.repo.session(role.sessionId);
  if(!['assigned','reconfirmed','en_route'].includes(role.status))throw new AppError(409,'CANNOT_CANCEL','Contact operations to end a shoot after arrival');
  const hours=(session.startAt.getTime()-now.getTime())/3600000,bps=hours>48?0:hours>=24?1000:hours>=2?2500:5000;
  return {roleId,penaltyPaise:Math.round(role.earningPaise*bps/10000),strike:hours>48?'none':hours>=24?'minor':'major',noShow:hours<2};
 }
 async cancel(accountId:string,roleId:string,body:unknown,now=new Date(),system=false){
  const b=z.object({reason:z.string().trim().min(5).max(1000),expectedPenaltyPaise:z.number().int().nonnegative()}).parse(body);
  return this.repo.db.transaction(async m=>{
   const creator=await this.repo.creator(accountId,m),initial=requireValue(await m.getRepository(RoleEntity).findOneBy({id:roleId}));const session=requireValue(await m.getRepository(SessionEntity).findOne({where:{id:initial.sessionId},lock:{mode:'pessimistic_write'}}));
   const [prior]=await m.query('SELECT * FROM creator_cancellations WHERE role_id=$1 AND creator_id=$2',[roleId,creator.id]);if(prior)return prior;
   const role=requireValue(await m.getRepository(RoleEntity).findOne({where:{id:roleId,creatorId:creator.id},lock:{mode:'pessimistic_write'}}));if(!['assigned','reconfirmed','en_route'].includes(role.status))throw new AppError(409,'CANNOT_CANCEL','Contact operations to end a shoot after arrival');
   const hours=(session.startAt.getTime()-now.getTime())/3600000,bps=hours>48?0:hours>=24?1000:hours>=2?2500:5000,penalty=Math.round(role.earningPaise*bps/10000),strike=hours>48?'none':hours>=24?'minor':'major';
   if(b.expectedPenaltyPaise!==penalty)throw new AppError(409,'PENALTY_CHANGED','Review the updated cancellation penalty before confirming');
   await m.getRepository(CreatorEntity).findOne({where:{id:creator.id},lock:{mode:'pessimistic_write'}});
   const [record]=await m.query('INSERT INTO creator_cancellations(role_id,creator_id,reason,strike,penalty_paise,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[roleId,creator.id,b.reason,strike,penalty,now]);
   await m.getRepository(RoleEntity).update(roleId,{creatorId:null,status:'confirmed'});await m.getRepository(SessionEntity).update(session.id,{status:'confirmed'});
   await m.query("UPDATE offers SET status='withdrawn' WHERE role_id=$1 AND status IN ('pending','accepted')",[roleId]);await m.query("UPDATE session_changes SET status='dismissed' WHERE session_id=$1 AND status='pending'",[session.id]);
   const noShow=hours<2,credit=noShow?Math.round(session.totalPaise*.2):0;
   await m.query("INSERT INTO service_failures(session_id,role_id,kind,credit_paise) VALUES($1,$2,$3,$4) ON CONFLICT(role_id,kind) DO UPDATE SET status='pending',credit_paise=greatest(service_failures.credit_paise,EXCLUDED.credit_paise),created_at=now()",[session.id,roleId,noShow?'no_show':'creator_cancelled',credit]);
   if(penalty>0)await this.repo.ledger(m,`creator-penalty:${record.id}`,session.orderId,[{account:'creator_penalty_receivable',amountPaise:penalty},{account:'creator_penalty_revenue',amountPaise:-penalty}]);
   const [strikes]=await m.query("SELECT count(*) FILTER(WHERE strike='major')::int AS major,count(*) FILTER(WHERE strike='none' AND created_at>=$3)::int AS free FROM creator_cancellations WHERE creator_id=$1 AND created_at>=$2",[creator.id,new Date(now.getTime()-90*86400000),new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1))]);
   if(strikes.major>=3||strikes.free>2)await this.repo.event(m,'creator_suspension_review',creator.id,{majorStrikes:strikes.major,freeCancellations:strikes.free});
   await this.repo.audit(m,system?null:accountId,system?'creator_no_show':'creator_cancelled',roleId,{reason:b.reason,penaltyPaise:penalty,strike,demoPolicy:true});await this.repo.event(m,'creator_cancelled',session.id);await this.repo.event(m,'dispatch_requested',roleId);return record;
  });
 }
 async detectNoShows(now=new Date()){
  const rows=await this.repo.db.query("SELECT r.id,c.account_id,r.earning_paise FROM roles r JOIN sessions s ON s.id=r.session_id JOIN creators c ON c.id=r.creator_id WHERE r.status IN ('assigned','reconfirmed','en_route') AND s.start_at<=$1 ORDER BY s.start_at LIMIT 100",[new Date(now.getTime()-30*60000)]);
  for(const r of rows){try{await this.cancel(r.account_id,r.id,{reason:'Automatic no-show: no verified arrival within 30 minutes after the scheduled start',expectedPenaltyPaise:Math.round(r.earning_paise*.5)},now,true);}catch(e){if(!(e instanceof AppError&&['CANNOT_CANCEL','NOT_FOUND'].includes(e.code)))throw e;}}
 }
 async failures(accountId:string,sessionId:string){const {session}=await this.repo.authorizedSession(sessionId,accountId);await this.repo.ownedOrder(session.orderId,accountId);return this.repo.db.query('SELECT id,kind,status,credit_paise,created_at FROM service_failures WHERE session_id=$1 ORDER BY created_at DESC',[sessionId]);}
 async chooseReplacement(accountId:string,sessionId:string){return this.repo.db.transaction(async m=>{const s=requireValue(await m.getRepository(SessionEntity).findOne({where:{id:sessionId},lock:{mode:'pessimistic_write'}}));await this.repo.ownedOrder(s.orderId,accountId,m);const [rows]=await m.query("UPDATE service_failures SET status='replacement' WHERE session_id=$1 AND status='pending' RETURNING id",[sessionId]);if(!rows.length)throw new AppError(409,'CHOICE_UNAVAILABLE','No replacement decision is pending');await this.repo.audit(m,accountId,'replacement_chosen',sessionId);return {replacement:true};});}
 async creatorHistory(accountId:string){const creator=await this.repo.creator(accountId);return this.repo.db.query('SELECT c.*,o.code FROM creator_cancellations c JOIN roles r ON r.id=c.role_id JOIN sessions s ON s.id=r.session_id JOIN orders o ON o.id=s.order_id WHERE c.creator_id=$1 ORDER BY c.created_at DESC LIMIT 100',[creator.id]);}
}
