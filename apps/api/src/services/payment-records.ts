import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {PlatformRepository} from '../repositories/platform';
import {AppError} from '../middleware/errors';

export class PaymentRecordsService {
  constructor(private repo:PlatformRepository,private demo:boolean){}

  async history(customerId:string,page:number){
    const orders=await this.repo.db.query(`SELECT o.id,o.code,o.status,o.total_paise,o.created_at,
      coalesce((SELECT sum(p.amount_paise) FROM payment_events p WHERE p.order_id=o.id),0)::int AS paid_paise,
      coalesce((SELECT sum(r.amount_paise) FROM refunds r JOIN sessions s ON s.id=r.session_id WHERE s.order_id=o.id),0)::int AS refund_paise
      FROM orders o WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 25 OFFSET $2`,[customerId,(page-1)*25]);
    return {orders,page,hasMore:orders.length===25,demo:this.demo};
  }

  async detail(customerId:string,orderId:string){
    const order=await this.repo.ownedOrder(orderId,customerId);
    const [payments,refunds,changes,prints]=await Promise.all([
      this.repo.db.query('SELECT id,provider,amount_paise,currency,created_at FROM payment_events WHERE order_id=$1 ORDER BY created_at',[orderId]),
      this.repo.db.query('SELECT r.* FROM refunds r JOIN sessions s ON s.id=r.session_id WHERE s.order_id=$1 ORDER BY r.created_at',[orderId]),
      this.repo.db.query("SELECT c.id,c.kind,c.delta_paise,c.credit_refund_paise,c.applied_at FROM session_changes c JOIN sessions s ON s.id=c.session_id WHERE s.order_id=$1 AND c.status='applied' ORDER BY c.applied_at",[orderId]),
      this.repo.db.query("SELECT p.id,p.status,p.total_paise,p.proof_approved_at FROM print_orders p JOIN galleries g ON g.id=p.gallery_id WHERE g.order_id=$1 AND p.proof_approved_at IS NOT NULL ORDER BY p.created_at",[orderId])
    ]);
    return {order,payments,refunds,changes,prints,demo:this.demo};
  }

  async statement(customerId:string,orderId:string){
    const data=await this.detail(customerId,orderId);
    if(!this.demo)throw new AppError(503,'INVOICE_CONFIGURATION_REQUIRED','Billing identity and approved tax configuration are required before issuing invoices');
    const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    pdf.setTitle(`Kamraw demo statement ${data.order.code}`);
    let page=pdf.addPage([595,842]),y=790;
    const ink=rgb(.12,.14,.12),red=rgb(.76,.25,.18);
    const line=(text:string,strong=false,size=11)=>{
      if(y<70){page=pdf.addPage([595,842]);y=790;}
      page.drawText(text,{x:44,y,size,font:strong?bold:font,color:strong?ink:rgb(.3,.32,.3)});y-=size+12;
    };
    line('kamraw.',true,30);y-=8;
    page.drawText('DEMO PAYMENT STATEMENT',{x:44,y,size:12,font:bold,color:red});y-=30;
    line('Sample document. No real funds moved. This is not a GST tax invoice.',false,10);
    line(`Booking ${data.order.code}`,true,17);
    line(`Statement generated ${new Date().toISOString().slice(0,16).replace('T',' ')} UTC`);
    line(`Booking status: ${data.order.status.replaceAll('_',' ')}`);
    line(`Current booking value: INR ${(data.order.totalPaise/100).toFixed(2)}`,true);y-=12;
    const money=(n:number)=>`INR ${(n/100).toFixed(2)}`;
    line('Payments',true,14);
    if(!data.payments.length)line('No payment has been recorded.');
    for(const p of data.payments)line(`${new Date(p.created_at).toISOString().slice(0,10)}   Simulated booking payment   ${money(p.amount_paise)}`);
    if(data.order.creditPaise)line(`Kamraw credit applied at checkout: ${money(data.order.creditPaise)}`);
    if(data.changes.length){y-=10;line('Booking changes',true,14);for(const c of data.changes){line(`${new Date(c.applied_at).toISOString().slice(0,10)}   ${c.kind}   ${money(c.delta_paise)} (simulated)`);if(c.credit_refund_paise)line(`Of this refund, ${money(c.credit_refund_paise)} returned to wallet.`);}}
    if(data.refunds.length){y-=10;line('Cancellation refunds',true,14);for(const r of data.refunds){line(`Refund ${r.id.slice(0,8)}   ${money(r.amount_paise)}   ${r.status.replaceAll('_',' ')}`);line(`Returned to wallet: ${money(r.credit_paise)}; to payment source: ${money(r.amount_paise-r.credit_paise)}`);line(`Cancellation fee retained: ${money(r.fee_paise)}`);}}
    if(data.prints.length){y-=10;line('Album orders (separate from booking value)',true,14);for(const p of data.prints)line(`${p.id.slice(0,8)}   ${money(p.total_paise)}   ${p.status.replaceAll('_',' ')} (simulated)`);}
    y-=14;line('Need help? Open Help & support in your Kamraw profile.',false,10);
    line('Commercial prices, tax details and policies require approval before launch.',false,10);
    for(const [i,p] of pdf.getPages().entries())p.drawText(`${data.order.code}  |  DEMO  |  Page ${i+1}`,{x:44,y:32,size:9,font,color:rgb(.4,.4,.4)});
    return {filename:`${data.order.code}-demo-statement.pdf`,base64:Buffer.from(await pdf.save()).toString('base64')};
  }
}
