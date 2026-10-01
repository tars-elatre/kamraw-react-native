import {z} from 'zod';
import {PlatformRepository} from '../repositories/platform';
import {AppError,requireValue} from '../middleware/errors';
export class PrivacyService {
 constructor(private repo:PlatformRepository,private demo:boolean){}
 async requests(accountId:string){return this.repo.db.query('SELECT id,kind,status,review_note,created_at,completed_at FROM privacy_requests WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100',[accountId]);}
 async queue(){return this.repo.db.query('SELECT p.*,a.name FROM privacy_requests p JOIN accounts a ON a.id=p.account_id ORDER BY p.created_at DESC LIMIT 100');}
 async export(accountId:string,id:string){
  return this.repo.db.transaction(async m=>{
   const [request]=await m.query("SELECT id FROM privacy_requests WHERE id=$1 AND account_id=$2 AND kind='export' FOR UPDATE",[id,accountId]);
   if(!request)throw new AppError(404,'NOT_FOUND','Export request not found');
   const account=await this.repo.account(accountId,m);
   const queries:Record<string,string>={
    orders:'SELECT id,code,category,status,total_paise,credit_paise,currency,created_at FROM orders WHERE customer_id=$1',
    sessions:'SELECT s.id,s.input,s.status,s.start_at,s.end_at FROM sessions s JOIN orders o ON o.id=s.order_id WHERE o.customer_id=$1',
    creator:'SELECT name,status,disciplines,languages,profile,checks,metrics FROM creators WHERE account_id=$1',
    tickets:'SELECT id,order_id,subject,body,category,status,created_at FROM tickets WHERE account_id=$1',
    supportMessages:'SELECT m.ticket_id,m.body,m.created_at FROM ticket_messages m JOIN tickets t ON t.id=m.ticket_id WHERE m.actor_id=$1 OR (t.account_id=$1 AND NOT m.internal)',
    phoneIdentity:'SELECT phone,demo FROM auth_phone_identities WHERE account_id=$1',
    messages:'SELECT session_id,body,created_at FROM messages WHERE actor_id=$1',
    completionRequests: `SELECT q.role_id,q.requested_at,q.available_after,q.location,q.status,q.reason FROM completion_requests q JOIN roles r ON r.id=q.role_id JOIN sessions s ON s.id=r.session_id JOIN orders o ON o.id=s.order_id WHERE q.actor_id=$1 OR o.customer_id=$1`,
    ratings:'SELECT session_id,kind,creator_id,stars,tags,comment,created_at FROM ratings WHERE rater_id=$1',
    payments:'SELECT p.id,p.order_id,p.provider,p.amount_paise,p.currency,p.created_at FROM payment_events p JOIN orders o ON o.id=p.order_id WHERE o.customer_id=$1',
    refunds:'SELECT r.* FROM refunds r JOIN sessions s ON s.id=r.session_id JOIN orders o ON o.id=s.order_id WHERE o.customer_id=$1',
    credits:'SELECT id,session_id,reference,amount_paise,expires_at,created_at FROM customer_credits WHERE customer_id=$1',
    creditSpending:'SELECT r.credit_id,r.order_id,r.amount_paise,r.created_at FROM credit_redemptions r JOIN customer_credits c ON c.id=r.credit_id WHERE c.customer_id=$1',
    bookingChanges:'SELECT id,session_id,kind,status,data,delta_paise,credit_refund_paise,created_at,applied_at FROM session_changes WHERE customer_id=$1',
    albumOrders:'SELECT id,gallery_id,configuration,address,status,total_paise,proof_version,proof_approved_at,tracking,created_at FROM print_orders WHERE customer_id=$1',
    galleries:'SELECT g.id,g.status,g.expires_at,g.final_delivered_at FROM galleries g JOIN orders o ON o.id=g.order_id WHERE o.customer_id=$1',
    shares:'SELECT sh.id,sh.kind,sh.invites,sh.allow_download,sh.expires_at,sh.revoked_at FROM shares sh JOIN galleries g ON g.id=sh.gallery_id JOIN orders o ON o.id=g.order_id WHERE o.customer_id=$1',
    favourites:'SELECT asset_id FROM favourites WHERE customer_id=$1',
    notifications:'SELECT title,body,entity_id,read_at,created_at FROM notifications WHERE account_id=$1',
    availability:'SELECT a.start_at,a.end_at,a.available FROM availability a JOIN creators c ON c.id=a.creator_id WHERE c.account_id=$1',
    creatorJobs:'SELECT r.id,r.session_id,r.status,r.discipline,r.tier,r.earning_paise,s.start_at,s.end_at FROM roles r JOIN creators c ON c.id=r.creator_id JOIN sessions s ON s.id=r.session_id WHERE c.account_id=$1',
    creatorCancellations:'SELECT x.role_id,x.reason,x.strike,x.penalty_paise,x.created_at FROM creator_cancellations x JOIN creators c ON c.id=x.creator_id WHERE c.account_id=$1',
    payouts:'SELECT p.id,p.run_id,p.amount_paise,p.status FROM payout_items p JOIN creators c ON c.id=p.creator_id WHERE c.account_id=$1',
    uploadedFiles:'SELECT a.id,a.filename,a.bytes,a.checksum,a.kind,a.status FROM media_assets a JOIN uploads u ON u.id=a.upload_id JOIN creators c ON c.id=u.creator_id WHERE c.account_id=$1',
    locationHistory:'SELECT l.session_id,l.lat,l.lng,l.accuracy,l.created_at FROM locations l JOIN creators c ON c.id=l.creator_id WHERE c.account_id=$1',
    incidents:'SELECT session_id,kind,notes,location,status,created_at FROM incidents WHERE account_id=$1'
   };
   const collections:Record<string,unknown>={};for(const [key,sql] of Object.entries(queries))collections[key]=await m.query(sql,[accountId]);
   await m.query("UPDATE privacy_requests SET status='completed',completed_at=now() WHERE id=$1",[id]);
   await this.repo.audit(m,accountId,'privacy_export_downloaded',id);
   return {generatedAt:new Date().toISOString(),account:{id:account.id,name:account.name,language:account.language,role:account.role,consents:account.consents},...collections};
  });
 }
 async review(actor:string,id:string,body:unknown){const b=z.object({action:z.enum(['request_information','complete_demo_deletion']),reason:z.string().trim().min(10).max(2000)}).parse(body);return this.repo.db.transaction(async m=>{const [r]=await m.query('SELECT * FROM privacy_requests WHERE id=$1 FOR UPDATE',[id]);requireValue(r);if(r.status==='completed')return {completed:true};if(b.action==='request_information'){await m.query("UPDATE privacy_requests SET status='needs_information',reviewed_by=$2,review_note=$3 WHERE id=$1",[id,actor,b.reason]);return {updated:true};}if(!this.demo)throw new AppError(503,'PRIVACY_PROVIDER_REQUIRED','Live deletion requires verified provider cleanup and an approved record-retention policy');await m.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE',[r.account_id]);if(r.kind!=='delete')throw new AppError(409,'WRONG_REQUEST','This request is not for deletion');const active=await m.query("SELECT 1 FROM sessions s JOIN orders o ON o.id=s.order_id WHERE o.customer_id=$1 AND s.status NOT IN ('cancelled','refunded','final_delivered','closed') UNION SELECT 1 FROM roles r JOIN creators c ON c.id=r.creator_id WHERE c.account_id=$1 AND r.status NOT IN ('cancelled','refunded','final_delivered','closed') UNION SELECT 1 FROM print_orders WHERE customer_id=$1 AND status IN ('in_production','shipped')",[r.account_id]);if(active.length)throw new AppError(409,'ACTIVE_BOOKINGS','Resolve active bookings before completing deletion');
 await m.query('UPDATE auth_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL',[r.account_id]);await m.query('DELETE FROM auth_challenges WHERE (phone,demo) IN(SELECT phone,demo FROM auth_phone_identities WHERE account_id=$1)',[r.account_id]);await m.query("UPDATE accounts SET name='Deleted demo account',consents='{}',disabled_at=now() WHERE id=$1",[r.account_id]);await m.query("UPDATE creators SET name='Deleted demo creator',profile='{}',status='suspended',online=false WHERE account_id=$1",[r.account_id]);await m.query("UPDATE shares SET revoked_at=now() WHERE gallery_id IN(SELECT g.id FROM galleries g JOIN orders o ON o.id=g.order_id WHERE o.customer_id=$1)",[r.account_id]);await m.query("UPDATE galleries SET status='expired',expires_at=now() WHERE order_id IN(SELECT id FROM orders WHERE customer_id=$1)",[r.account_id]);await m.query("UPDATE messages SET body='[Removed at account request]' WHERE actor_id=$1",[r.account_id]);await m.query("UPDATE ratings SET comment='' WHERE rater_id=$1",[r.account_id]);await m.query("UPDATE tickets SET subject='[Removed at account request]',body='[Removed at account request]' WHERE account_id=$1",[r.account_id]);await m.query("UPDATE ticket_messages SET body='[Removed at account request]' WHERE actor_id=$1",[r.account_id]);await m.query("UPDATE print_orders SET address='{}' WHERE customer_id=$1",[r.account_id]);
 await m.query("UPDATE session_changes SET data=data-'input' WHERE customer_id=$1",[r.account_id]);await m.query("UPDATE incidents SET notes='[Removed at account request]',location=NULL WHERE account_id=$1",[r.account_id]);await m.query("UPDATE completion_requests SET location=NULL,reason='[Removed at account request]' WHERE actor_id=$1 OR role_id IN(SELECT r.id FROM roles r JOIN sessions s ON s.id=r.session_id JOIN orders o ON o.id=s.order_id WHERE o.customer_id=$1)",[r.account_id]);await m.query('DELETE FROM locations WHERE creator_id IN(SELECT id FROM creators WHERE account_id=$1) OR session_id IN(SELECT s.id FROM sessions s JOIN orders o ON o.id=s.order_id WHERE o.customer_id=$1)',[r.account_id]);await m.query("UPDATE session_events SET payload=payload-'location' WHERE actor_id=$1",[r.account_id]);
 const sessions=await m.query('SELECT s.id,s.input FROM sessions s JOIN orders o ON o.id=s.order_id WHERE o.customer_id=$1',[r.account_id]);for(const s of sessions){const input={...s.input,notes:'',venue:{type:s.input.venue.type,lat:0,lng:0,address:'Removed',contactName:'Removed',contactPhone:'Removed',notes:''}};await m.query('UPDATE sessions SET input=$2 WHERE id=$1',[s.id,JSON.stringify(input)]);}await m.query("UPDATE quotes SET input=jsonb_build_object('category',input->>'category','sessions','[]'::jsonb,'termsVersion',input->>'termsVersion') WHERE customer_id=$1",[r.account_id]);await m.query("UPDATE privacy_requests SET status='completed',reviewed_by=$2,review_note=$3,completed_at=now() WHERE id=$1",[id,actor,b.reason]);await this.repo.audit(m,actor,'demo_privacy_deletion',id,{accountId:r.account_id,retained:'financial and immutable audit records; blocked identity reference'});return {completed:true,retained:'Financial and audit records and the blocked identity reference remain. Live provider deletion is not simulated.'};});}
}
