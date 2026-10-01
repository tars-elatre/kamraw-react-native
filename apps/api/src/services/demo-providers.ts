import {notifyEvent} from './notifications';
import type {EntityManager} from 'typeorm';
import {PlatformRepository} from '../repositories/platform';
// Deterministic sandbox settlement. No network calls or real funds are involved.
export async function settleDemo(repo:PlatformRepository,m:EntityManager,event:{kind:string;entity_id:string}){
 if(event.kind==='refund_requested'){
  const [refund]=await m.query("SELECT r.*,s.order_id FROM refunds r JOIN sessions s ON s.id=r.session_id WHERE r.id=$1 AND r.status='pending' FOR UPDATE OF r",[event.entity_id]);
  if(refund){if(refund.amount_paise>0)await repo.ledger(m,`demo-refund:${refund.id}`,refund.order_id,[{account:'refund_payable',amountPaise:refund.amount_paise},{account:'gateway_clearing',amountPaise:-refund.amount_paise}]);await m.query("UPDATE refunds SET status='simulated_refunded' WHERE id=$1",[refund.id]);await repo.audit(m,null,'demo_refund_settled',refund.id,{simulation:true});}
 }
 if(event.kind==='payout_requested'){
  const [run]=await m.query("SELECT * FROM payout_runs WHERE id=$1 AND status='approved' FOR UPDATE",[event.entity_id]);
  if(run){const [deductions]=await m.query('SELECT coalesce(sum(amount_paise),0)::int AS total FROM payout_deductions WHERE run_id=$1',[run.id]);await repo.ledger(m,`demo-payout:${run.id}`,null,[{account:'creator_cost',amountPaise:run.total_paise+deductions.total},{account:'creator_penalty_receivable',amountPaise:-deductions.total},{account:'demo_payout_clearing',amountPaise:-run.total_paise}]);await m.query("UPDATE payout_items SET status='simulated_paid' WHERE run_id=$1",[run.id]);await m.query("UPDATE payout_runs SET status='simulated_paid' WHERE id=$1",[run.id]);await repo.audit(m,null,'demo_payout_settled',run.id,{simulation:true});}
 }
}
export async function drainDemoOutbox(repo:PlatformRepository){return repo.db.transaction(async m=>{const events=await m.query("SELECT id,kind,entity_id FROM outbox WHERE status='pending' AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50") as {id:string;kind:string;entity_id:string}[];for(const event of events){await settleDemo(repo,m,event);await notifyEvent(m,event);await m.query("UPDATE outbox SET status='simulated',attempts=attempts+1 WHERE id=$1",[event.id]);}return events.length;});}
