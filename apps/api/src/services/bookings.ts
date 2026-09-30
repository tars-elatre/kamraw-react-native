import {randomInt} from 'node:crypto';
import {bookingSchema,cancellation,pointInPolygon,quotePrice,validateSessionTime,type RateCard} from '@kamraw/domain';
import {OrderEntity,QuoteEntity,RoleEntity,SessionEntity} from '../entities';
import {AppError,requireValue} from '../middleware/errors';
import {PlatformRepository} from '../repositories/platform';
export class BookingService {
  constructor(private repo:PlatformRepository){}
  async quote(customerId:string,body:unknown,now=new Date()){
    const input=bookingSchema.parse(body),{rates,zones}=await this.repo.config();
    let price;try{price=quotePrice(input,zones,rates,now);}catch(e){throw new AppError(422,'BOOKING_UNAVAILABLE',(e as Error).message);}
    const supply: {sessionIndex:number;discipline:string;tier:string;eligible:number;requested:number}[]=[];
    for(const [i,s] of input.sessions.entries())for(const r of s.roles){const zone=zones.find(z=>z.active&&pointInPolygon(s.venue,z.polygon))!;const [row]=await this.repo.db.query(`SELECT count(*)::int AS count FROM creators c WHERE c.status='active' AND ($1='scheduled' OR c.online) AND c.disciplines->>$2=$3 AND c.zone_ids ? $4 AND NOT EXISTS(SELECT 1 FROM customer_blocks b WHERE b.customer_id=$5 AND b.creator_id=c.id) AND NOT EXISTS(SELECT 1 FROM roles x WHERE x.creator_id=c.id AND x.status NOT IN ('cancelled','refunded') AND tstzrange(x.reserved_start,x.reserved_end,'[)') && tstzrange($6::timestamptz-interval '80 minutes',$6::timestamptz+($7||' hours')::interval+interval '30 minutes','[)'))`,[s.mode,r.discipline,r.tier,zone.id,customerId,s.start,s.hours]) as {count:number}[];supply.push({sessionIndex:i,discipline:r.discipline,tier:r.tier,eligible:row!.count,requested:r.count});}
    const quote=await this.repo.db.getRepository(QuoteEntity).save({customerId,input,price,expiresAt:new Date(now.getTime()+600000)});
    return {...quote,supply,available:supply.every(s=>s.eligible>=s.requested)};
  }
  async checkout(customerId:string,quoteId:string,now=new Date()){
    return this.repo.db.transaction(async m=>{
      const quote=requireValue(await m.getRepository(QuoteEntity).findOne({where:{id:quoteId,customerId},lock:{mode:'pessimistic_write'}}));
      if(quote.orderId)return this.repo.order(quote.orderId,m);
      if(quote.expiresAt<=now)throw new AppError(409,'QUOTE_EXPIRED','Your quote has expired. Refresh the price to continue.');
      const order=await m.getRepository(OrderEntity).save({customerId,quoteId,category:quote.input.category,totalPaise:quote.price.totalPaise,currency:'INR',status:'payment_pending'});
      await m.getRepository(QuoteEntity).update(quote.id,{orderId:order.id});await this.repo.audit(m,customerId,'checkout_created',order.id);return order;
    });
  }
  async confirmPayment(event:{id:string;orderId:string;amountPaise:number;currency:string;provider:string},now=new Date()){
    return this.repo.db.transaction(async m=>{
      const order=requireValue(await m.getRepository(OrderEntity).findOne({where:{id:event.orderId},lock:{mode:'pessimistic_write'}}));
      if(order.totalPaise!==event.amountPaise||event.currency!=='INR')throw new AppError(422,'PAYMENT_MISMATCH','Payment amount or currency does not match');
      const prior=await m.query('SELECT order_id FROM payment_events WHERE id=$1',[event.id]) as {order_id:string}[];
      if(prior.length){if(prior[0]!.order_id!==order.id)throw new AppError(409,'EVENT_REUSED','Payment event already consumed');return order;}
      if(order.status!=='payment_pending')throw new AppError(409,'ALREADY_PAID','Booking is already paid');
      const quote=requireValue(await m.getRepository(QuoteEntity).findOneBy({id:order.quoteId}));
      if(quote.expiresAt<=now)throw new AppError(409,'QUOTE_EXPIRED','Payment arrived after the quote expired; reconciliation is required');
      const {zones}=await this.repo.config(m);
      const savedRates=await m.query("SELECT value FROM configurations WHERE kind='rates' AND version=$1",[quote.price.version]) as {value:RateCard}[];
      const rate=requireValue(savedRates[0]).value;
      for(const s of quote.input.sessions){const z=zones.find(z=>z.active&&pointInPolygon(s.venue,z.polygon));if(!z)throw new AppError(409,'ZONE_PAUSED','Service zone is no longer available');try{validateSessionTime(s,now,z.leadMinutes,z.openHour,z.closeHour);}catch(e){throw new AppError(409,'START_CHANGED',(e as Error).message);}}
      await m.query('INSERT INTO payment_events(id,order_id,provider,amount_paise,currency) VALUES($1,$2,$3,$4,$5)',[event.id,order.id,event.provider,event.amountPaise,event.currency]);
      for(const [i,s] of quote.input.sessions.entries()){
        const zone=zones.find(z=>z.active&&pointInPolygon(s.venue,z.polygon))!;
        const start=new Date(s.start),end=new Date(start.getTime()+s.hours*3600000);
        const session=await m.getRepository(SessionEntity).save({orderId:order.id,input:s,status:'confirmed',startAt:start,endAt:end,zoneId:zone.id,totalPaise:quote.price.sessionTotals[i],completionCode:String(randomInt(100000,1000000))});
        let isFirst=true;
        for(const role of s.roles)for(let n=0;n<role.count;n++){
          const roleRow=await m.getRepository(RoleEntity).save({sessionId:session.id,discipline:role.discipline,tier:role.tier,status:'confirmed',earningPaise:rate.rates[`${role.discipline}:${role.tier}`]!.earningHourPaise*s.hours,lead:isFirst,reservedStart:new Date(start.getTime()-80*60000),reservedEnd:new Date(end.getTime()+30*60000)});isFirst=false;await this.repo.event(m,'dispatch_requested',roleRow.id);
        }
      }
      await m.query('INSERT INTO galleries(order_id) VALUES($1)',[order.id]);
      await this.repo.ledger(m,`payment:${event.id}`,order.id,[{account:'gateway_clearing',amountPaise:event.amountPaise},{account:'customer_deposits',amountPaise:-event.amountPaise}]);
      await m.getRepository(OrderEntity).update(order.id,{status:'confirmed'});await this.repo.audit(m,null,'payment_confirmed',order.id,{provider:event.provider,eventId:event.id});await this.repo.event(m,'booking_confirmed',order.id);return {...order,status:'confirmed'};
    });
  }
  async cancelPreview(customerId:string,sessionId:string,now=new Date()){
    const {session,order}=await this.repo.authorizedSession(sessionId,customerId);if(order.customerId!==customerId)throw new AppError(403,'FORBIDDEN','Only the customer can cancel this session');
    if(!['confirmed','assigned','reconfirmed','en_route','arrived'].includes(session.status))throw new AppError(409,'CANNOT_CANCEL','This session can no longer be cancelled; please contact support');
    const {rates}=await this.repo.config();return {...cancellation(session.totalPaise,session.startAt,now,session.status,rates.cancellationBps),sessionId};
  }
  async cancel(customerId:string,sessionId:string,expectedFee:number,now=new Date()){
    return this.repo.db.transaction(async m=>{
      const session=requireValue(await m.getRepository(SessionEntity).findOne({where:{id:sessionId},lock:{mode:'pessimistic_write'}}));await this.repo.ownedOrder(session.orderId,customerId,m);
      const existing=await m.query('SELECT * FROM refunds WHERE session_id=$1',[sessionId]);if(existing.length)return existing[0];
      if(!['confirmed','assigned','reconfirmed','en_route','arrived'].includes(session.status))throw new AppError(409,'CANNOT_CANCEL','This session cannot be cancelled');
      const {rates}=await this.repo.config(m);const fee=cancellation(session.totalPaise,session.startAt,now,session.status,rates.cancellationBps);
      if(fee.feePaise!==expectedFee)throw new AppError(409,'FEE_CHANGED','The cancellation fee changed. Review the new amount before confirming.');
      await m.getRepository(SessionEntity).update(sessionId,{status:'cancelled'});await m.getRepository(RoleEntity).update({sessionId},{status:'cancelled'});await m.query("UPDATE offers SET status='withdrawn' WHERE role_id IN(SELECT id FROM roles WHERE session_id=$1) AND status='pending'",[sessionId]);
      const [refund]=await m.query('INSERT INTO refunds(session_id,amount_paise,fee_paise,method) VALUES($1,$2,$3,$4) RETURNING *',[sessionId,fee.refundPaise,fee.feePaise,'source']);
      await this.repo.ledger(m,`cancellation:${sessionId}`,session.orderId,[{account:'customer_deposits',amountPaise:session.totalPaise},{account:'refund_payable',amountPaise:-fee.refundPaise},{account:'cancellation_revenue',amountPaise:-fee.feePaise}]);
      await m.query("UPDATE orders SET status='cancelled' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM sessions WHERE order_id=$1 AND status<>'cancelled')",[session.orderId]);
      await this.repo.audit(m,customerId,'session_cancelled',sessionId,fee);await this.repo.event(m,'refund_requested',refund.id,{amountPaise:fee.refundPaise});return refund;
    });
  }
  async demoPay(customerId:string,id:string){const order=await this.repo.ownedOrder(id,customerId);return this.confirmPayment({id:`demo:${id}`,orderId:id,amountPaise:order.totalPaise,currency:'INR',provider:'demo'});}
}
