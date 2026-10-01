import type {EntityManager} from 'typeorm';
import {AppError} from '../middleware/errors';

// Callers lock the customer account before spending. Checkout quotes do not reserve credits.
export async function availableCredits(m:EntityManager,customerId:string){
  return m.query(`SELECT c.id,c.amount_paise,c.reference,c.created_at,c.expires_at,
    (c.amount_paise-coalesce((SELECT sum(r.amount_paise) FROM credit_redemptions r WHERE r.credit_id=c.id),0))::int AS balance_paise
    FROM customer_credits c WHERE c.customer_id=$1 AND (c.expires_at IS NULL OR c.expires_at>now())
    ORDER BY c.expires_at NULLS LAST,c.created_at,c.id`,[customerId]) as Promise<{id:string;amount_paise:number;balance_paise:number;reference:string;created_at:Date;expires_at:Date|null}[]>;
}
export async function spendCredits(m:EntityManager,customerId:string,orderId:string,amount:number){
  if(!amount)return;
  const credits=await availableCredits(m,customerId);
  if(credits.reduce((n,c)=>n+c.balance_paise,0)<amount)throw new AppError(409,'CREDIT_CHANGED','Your available credit changed. Refresh the booking quote before paying.');
  let remaining=amount;
  for(const credit of credits){const used=Math.min(remaining,credit.balance_paise);if(used>0)await m.query('INSERT INTO credit_redemptions(credit_id,order_id,amount_paise) VALUES($1,$2,$3)',[credit.id,orderId,used]);remaining-=used;if(!remaining)break;}
}
export function splitRefund(refund:number,total:number,credit:number){
  const creditPaise=refund===total?credit:Math.min(credit,Number((2n*BigInt(refund)*BigInt(credit)+BigInt(total))/(2n*BigInt(total))));
  return {creditPaise,sourcePaise:refund-creditPaise};
}
export async function returnCredit(m:EntityManager,customerId:string,sessionId:string,reference:string,amount:number){
  if(amount>0)await m.query('INSERT INTO customer_credits(customer_id,session_id,reference,amount_paise) VALUES($1,$2,$3,$4)',[customerId,sessionId,reference,amount]);
}
