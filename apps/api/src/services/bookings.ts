import {availableCredits,spendCredits,splitRefund,returnCredit} from './credits';
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
  async checkout(customerId:string,quoteId:string,now=new Date(),useCredits=false,expectedCreditPaise?:number){
    return this.repo.db.transaction(async m=>{
      const quote=requireValue(await m.getRepository(QuoteEntity).findOne({where:{id:quoteId,customerId},lock:{mode:'pessimistic_write'}}));
      const [active]=await m.query('SELECT id FROM accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[customerId]);if(!active)throw new AppError(401,'ACCOUNT_CLOSED','This account is closed');
      const previous=quote.orderId?await this.repo.order(quote.orderId,m):null;if(previous&&previous.status!=='payment_pending')return previous;
      const available=useCredits?Math.min(quote.price.totalPaise,(await availableCredits(m,customerId)).reduce((n,c)=>n+c.balance_paise,0)):0;
      const creditPaise=useCredits?(expectedCreditPaise??available):0;
      if(creditPaise>available||creditPaise<0)throw new AppError(409,'CREDIT_CHANGED','Refresh the quote to review your available credit.');
      if(previous){if(previous.creditPaise!==creditPaise)throw new AppError(409,'CHECKOUT_CHANGED','Refresh the price before changing credits on an existing checkout.');return previous;}
      if(quote.expiresAt<=now)throw new AppError(409,'QUOTE_EXPIRED','Your quote has expired. Refresh the price to continue.');
      const order=await m.getRepository(OrderEntity).save({customerId,quoteId,creditPaise,category:quote.input.category,totalPaise:quote.price.totalPaise,currency:'INR',status:'payment_pending'});
      await m.getRepository(QuoteEntity).update(quote.id,{orderId:order.id});await this.repo.audit(m,customerId,'checkout_created',order.id);return order;
    });
  }
  async confirmPayment(event:{id:string;orderId:string;amountPaise:number;currency:string;provider:string},now=new Date()){
    return this.repo.db.transaction(async m=>{
      const order=requireValue(await m.getRepository(OrderEntity).findOne({where:{id:event.orderId},lock:{mode:'pessimistic_write'}}));
      const [active]=await m.query('SELECT id FROM accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[order.customerId]);if(!active)throw new AppError(409,'ACCOUNT_CLOSED','This account is closed; payment reconciliation is required');
      const prior=await m.query('SELECT order_id,amount_paise,currency,provider FROM payment_events WHERE id=$1',[event.id]) as {order_id:string;amount_paise:number;currency:string;provider:string}[];
      if(prior.length){const p=prior[0]!;if(p.order_id!==order.id||p.amount_paise!==event.amountPaise||p.currency!==event.currency||p.provider!==event.provider)throw new AppError(409,'EVENT_REUSED','Payment event already consumed with different details');return order;}
      if(order.totalPaise-order.creditPaise!==event.amountPaise||event.currency!=='INR')throw new AppError(422,'PAYMENT_MISMATCH','Payment amount or currency does not match');
      if(order.status!=='payment_pending')throw new AppError(409,'ALREADY_PAID','Booking is already paid');
      const quote=requireValue(await m.getRepository(QuoteEntity).findOneBy({id:order.quoteId}));
      if(quote.expiresAt<=now)throw new AppError(409,'QUOTE_EXPIRED','Payment arrived after the quote expired; reconciliation is required');
      const {zones}=await this.repo.config(m);
      const savedRates=await m.query("SELECT value FROM configurations WHERE kind='rates' AND version=$1",[quote.price.version]) as {value:RateCard}[];
      const rate=requireValue(savedRates[0]).value;
      for(const s of quote.input.sessions){const z=zones.find(z=>z.active&&pointInPolygon(s.venue,z.polygon));if(!z)throw new AppError(409,'ZONE_PAUSED','Service zone is no longer available');try{validateSessionTime(s,now,z.leadMinutes,z.openHour,z.closeHour);}catch(e){throw new AppError(409,'START_CHANGED',(e as Error).message);}}
      await spendCredits(m,order.customerId,order.id,order.creditPaise);
      await m.query('INSERT INTO payment_events(id,order_id,provider,amount_paise,currency) VALUES($1,$2,$3,$4,$5)',[event.id,order.id,event.provider,event.amountPaise,event.currency]);
      let creditAllocated=0;
      for(const [i,s] of quote.input.sessions.entries()){
        const zone=zones.find(z=>z.active&&pointInPolygon(s.venue,z.polygon))!;
        const start=new Date(s.start),end=new Date(start.getTime()+s.hours*3600000);
        const creditPaise=i===quote.input.sessions.length-1?order.creditPaise-creditAllocated:Number(BigInt(order.creditPaise)*BigInt(quote.price.sessionTotals[i]!)/BigInt(order.totalPaise));creditAllocated+=creditPaise;
        const session=await m.getRepository(SessionEntity).save({orderId:order.id,creditPaise,input:s,status:'confirmed',startAt:start,endAt:end,zoneId:zone.id,totalPaise:quote.price.sessionTotals[i],completionCode:String(randomInt(100000,1000000))});
        let isFirst=true;
        for(const role of s.roles)for(let n=0;n<role.count;n++){
          const roleRow=await m.getRepository(RoleEntity).save({sessionId:session.id,discipline:role.discipline,tier:role.tier,status:'confirmed',earningPaise:rate.rates[`${role.discipline}:${role.tier}`]!.earningHourPaise*s.hours,lead:isFirst,reservedStart:new Date(start.getTime()-80*60000),reservedEnd:new Date(end.getTime()+30*60000)});isFirst=false;await this.repo.event(m,'dispatch_requested',roleRow.id);
        }
      }
      await m.query('INSERT INTO galleries(order_id) VALUES($1)',[order.id]);
      await this.repo.ledger(m,`payment:${event.id}`,order.id,[{account:'gateway_clearing',amountPaise:event.amountPaise},{account:'customer_credit_liability',amountPaise:order.creditPaise},{account:'customer_deposits',amountPaise:-order.totalPaise}]);
      await m.getRepository(OrderEntity).update(order.id,{status:'confirmed'});await this.repo.audit(m,null,'payment_confirmed',order.id,{provider:event.provider,eventId:event.id});await this.repo.event(m,'booking_confirmed',order.id);return {...order,status:'confirmed'};
    });
  }
  async cancelPreview(customerId:string,sessionId:string,now=new Date()){
    const {session,order}=await this.repo.authorizedSession(sessionId,customerId);if(order.customerId!==customerId)throw new AppError(403,'FORBIDDEN','Only the customer can cancel this session');
    if(!['confirmed','assigned','reconfirmed','en_route','arrived'].includes(session.status))throw new AppError(409,'CANNOT_CANCEL','This session can no longer be cancelled; please contact support');
    const {rates}=await this.repo.config();const [failure]=await this.repo.db.query("SELECT max(credit_paise)::int AS credit FROM service_failures WHERE session_id=$1 AND status='pending'",[sessionId]);const fault=failure?.credit!==null;const fee=cancellation(session.totalPaise,session.startAt,now,session.status,rates.cancellationBps,fault),split=splitRefund(fee.refundPaise,session.totalPaise,session.creditPaise);return {...fee,creditRefundPaise:split.creditPaise,sourceRefundPaise:split.sourcePaise,creditPaise:failure?.credit??0,platformFault:fault,sessionId};
  }
  async cancel(customerId:string,sessionId:string,expectedFee:number,now=new Date(),refundMethod:'source'|'credit'='source'){
    return this.repo.db.transaction(async m=>{
      const session=requireValue(await m.getRepository(SessionEntity).findOne({where:{id:sessionId},lock:{mode:'pessimistic_write'}}));await this.repo.ownedOrder(session.orderId,customerId,m);
      const existing=await m.query('SELECT * FROM refunds WHERE session_id=$1',[sessionId]);if(existing.length)return existing[0];
      if(!['confirmed','assigned','reconfirmed','en_route','arrived'].includes(session.status))throw new AppError(409,'CANNOT_CANCEL','This session cannot be cancelled');
      const {rates}=await this.repo.config(m);const [failure]=await m.query("SELECT max(credit_paise)::int AS credit FROM service_failures WHERE session_id=$1 AND status='pending'",[sessionId]);const fee=cancellation(session.totalPaise,session.startAt,now,session.status,rates.cancellationBps,failure?.credit!==null);
      if(fee.feePaise!==expectedFee)throw new AppError(409,'FEE_CHANGED','The cancellation fee changed. Review the new amount before confirming.');
      const assigned=(await m.getRepository(RoleEntity).findBy({sessionId})).filter(r=>r.creatorId&&!['cancelled','refunded'].includes(r.status));if(fee.feePaise>0&&assigned.length){const earningTotal=assigned.reduce((sum,r)=>sum+r.earningPaise,0);let allocated=0;for(const [index,r] of assigned.entries()){const pool=Math.round(fee.feePaise*.5);const amount=session.status==='arrived'?r.earningPaise:index===assigned.length-1?pool-allocated:Math.floor(pool*(earningTotal?r.earningPaise/earningTotal:1/assigned.length));allocated+=amount;if(amount>0)await m.query('INSERT INTO creator_compensation(role_id,creator_id,amount_paise,reason) VALUES($1,$2,$3,$4)',[r.id,r.creatorId,amount,'Customer cancellation compensation']);}}
      await m.getRepository(SessionEntity).update(sessionId,{status:'cancelled'});await m.getRepository(RoleEntity).update({sessionId},{status:'cancelled'});await m.query("UPDATE offers SET status='withdrawn' WHERE role_id IN(SELECT id FROM roles WHERE session_id=$1) AND status='pending'",[sessionId]);
      await m.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[session.orderId]);await m.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[customerId]);
      const split=refundMethod==='credit'?{creditPaise:fee.refundPaise,sourcePaise:0}:splitRefund(fee.refundPaise,session.totalPaise,session.creditPaise);await returnCredit(m,customerId,sessionId,`refund:${sessionId}`,split.creditPaise);
      const [refund]=await m.query('INSERT INTO refunds(session_id,amount_paise,fee_paise,method,credit_paise) VALUES($1,$2,$3,$4,$5) RETURNING *',[sessionId,fee.refundPaise,fee.feePaise,refundMethod==='credit'?'credit':split.creditPaise?'mixed':'source',split.creditPaise]);
      await this.repo.ledger(m,`cancellation:${sessionId}`,session.orderId,[{account:'customer_deposits',amountPaise:session.totalPaise},{account:'refund_payable',amountPaise:-split.sourcePaise},{account:'customer_credit_liability',amountPaise:-split.creditPaise},{account:'cancellation_revenue',amountPaise:-fee.feePaise}]);
      await m.query("UPDATE orders SET status='cancelled' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM sessions WHERE order_id=$1 AND status<>'cancelled')",[session.orderId]);
      if(failure?.credit>0){await m.query('INSERT INTO customer_credits(customer_id,session_id,reference,amount_paise) VALUES($1,$2,$3,$4)',[customerId,sessionId,`no-show:${sessionId}`,failure.credit]);await this.repo.ledger(m,`no-show-credit:${sessionId}`,session.orderId,[{account:'service_recovery_cost',amountPaise:failure.credit},{account:'customer_credit_liability',amountPaise:-failure.credit}]);}await m.query("UPDATE service_failures SET status='refunded' WHERE session_id=$1 AND status='pending'",[sessionId]);
      await this.repo.audit(m,customerId,'session_cancelled',sessionId,fee);await this.repo.event(m,'refund_requested',refund.id,{amountPaise:split.sourcePaise,creditPaise:split.creditPaise});return refund;
    });
  }
  async demoPay(customerId:string,id:string){const order=await this.repo.ownedOrder(id,customerId);if(order.status!=='payment_pending'){const [paid]=await this.repo.db.query('SELECT id FROM payment_events WHERE id=$1',[`demo:${id}`]);if(paid)return order;}return this.confirmPayment({id:`demo:${id}`,orderId:id,amountPaise:order.totalPaise-order.creditPaise,currency:'INR',provider:'demo'});}
}
