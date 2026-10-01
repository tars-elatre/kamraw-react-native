import {createHash,randomBytes,randomInt,randomUUID,scryptSync,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {EntityManager} from 'typeorm';
import {AccountEntity,type Account} from '../entities';
import {PlatformRepository} from '../repositories/platform';
import {AppError} from '../middleware/errors';
const tokenHash=(value:string)=>createHash('sha256').update(value).digest('hex');
const phoneSchema=z.string().trim().transform(p=>p.replace(/[\s()-]/g,'')).transform(p=>/^\d{10}$/.test(p)?`+91${p}`:p).pipe(z.string().regex(/^\+91[6-9]\d{9}$/,'Enter a valid Indian mobile number'));
// SMS delivery is intentionally unavailable until an actual provider is connected.
export class AuthenticationService {
 constructor(private repo:PlatformRepository,private demo:boolean){}
 private async issue(m:EntityManager,account:Account,now:Date,mfa=false){
  const [state]=await m.query('SELECT disabled_at FROM accounts WHERE id=$1 FOR UPDATE',[account.id]);if(state.disabled_at)throw new AppError(401,'ACCOUNT_CLOSED','This account has been closed');
  const token=`kmr_${randomBytes(32).toString('base64url')}`,expiresAt=new Date(now.getTime()+(mfa?8*3600000:14*86400000));
  await m.query('INSERT INTO auth_sessions(account_id,token_hash,demo,mfa,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[account.id,tokenHash(token),this.demo,mfa,now,expiresAt]);
  return {token,expiresAt,account,demo:this.demo};
 }
 async demoLogin(body:unknown,now=new Date()){
  if(!this.demo)throw new AppError(404,'NOT_FOUND','Not found');const {handle}=z.object({handle:z.string().regex(/^[a-z0-9_-]{1,30}$/)}).parse(body);
  return this.repo.db.transaction(async m=>{const account=await m.getRepository(AccountEntity).findOneBy({subject:`demo:${handle}`});if(!account)throw new AppError(401,'LOGIN_REQUIRED','Choose an available demo account');return this.issue(m,account,now,!['customer','creator'].includes(account.role));});
 }
 async requestCode(body:unknown,now=new Date()){
  const {phone}=z.object({phone:phoneSchema}).parse(body);
  if(!this.demo)throw new AppError(503,'SMS_PROVIDER_REQUIRED','Phone verification is not available yet. Please contact Kamraw support.');
  return this.repo.db.transaction(async m=>{
   await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,41))',[`${this.demo}:${phone}`]);
   const [recent]=await m.query('SELECT count(*)::int AS n,max(created_at) AS last FROM auth_challenges WHERE phone=$1 AND demo=$2 AND created_at>$3',[phone,this.demo,new Date(now.getTime()-15*60000)]);
   if(recent.n>=5||(recent.last&&now.getTime()-new Date(recent.last).getTime()<60000))throw new AppError(429,'CODE_THROTTLED','Please wait before requesting another code.');
   await m.query('UPDATE auth_challenges SET consumed_at=$3 WHERE phone=$1 AND demo=$2 AND consumed_at IS NULL',[phone,this.demo,now]);
   const id=randomUUID(),code=String(randomInt(1000000)).padStart(6,'0'),salt=randomBytes(16).toString('hex'),expiresAt=new Date(now.getTime()+5*60000);
   await m.query('INSERT INTO auth_challenges(id,phone,demo,code_hash,salt,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,phone,this.demo,scryptSync(code,salt,32).toString('hex'),salt,now,expiresAt]);
   return {challengeId:id,phone,expiresAt,retryAfterSeconds:60,demo:true,demoCode:code};
  });
 }
 async verifyCode(body:unknown,now=new Date()){
  const b=z.object({challengeId:z.uuid(),code:z.string().regex(/^\d{6}$/),name:z.string().trim().min(2).max(100).optional(),language:z.enum(['en','ta']).default('en')}).parse(body);
  const result=await this.repo.db.transaction(async m=>{
   const [initial]=await m.query('SELECT phone FROM auth_challenges WHERE id=$1 AND demo=$2',[b.challengeId,this.demo]);if(!initial)return {error:true} as const;
   await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,41))',[`${this.demo}:${initial.phone}`]);
   const [q]=await m.query('SELECT * FROM auth_challenges WHERE id=$1 AND demo=$2 FOR UPDATE',[b.challengeId,this.demo]);
   if(!q||q.consumed_at||q.expires_at<=now||q.attempts>=5)return {error:true} as const;
   const matches=timingSafeEqual(scryptSync(b.code,q.salt,32),Buffer.from(q.code_hash,'hex'));
   await m.query('UPDATE auth_challenges SET attempts=attempts+1,consumed_at=CASE WHEN $2 OR attempts>=4 THEN $3 ELSE consumed_at END WHERE id=$1',[q.id,matches,now]);
   if(!matches)return {error:true} as const;
   await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,41))',[`${this.demo}:${q.phone}`]);
   const [identity]=await m.query('SELECT account_id FROM auth_phone_identities WHERE phone=$1 AND demo=$2',[q.phone,this.demo]);
   let account:Account;
   if(identity)account=await m.getRepository(AccountEntity).findOneByOrFail({id:identity.account_id});
   else{account=await m.getRepository(AccountEntity).save({subject:`${this.demo?'demo-phone':'phone'}:${randomUUID()}`,name:b.name??'Kamraw customer',role:'customer',language:b.language,consents:{}});await m.query('INSERT INTO auth_phone_identities(phone,demo,account_id) VALUES($1,$2,$3)',[q.phone,this.demo,account.id]);}
   const session=await this.issue(m,account,now);await this.repo.audit(m,account.id,'phone_sign_in',account.id,{demo:this.demo});return {session};
  });
  if('error' in result)throw new AppError(401,'INVALID_CODE','This code is invalid or expired. Request a new code if needed.');return result.session;
 }
 async authenticate(token:string|undefined,now=new Date()){
  if(!token||!/^kmr_[A-Za-z0-9_-]{43}$/.test(token))throw new AppError(401,'LOGIN_REQUIRED','Please sign in');
  const [session]=await this.repo.db.query('SELECT s.account_id,s.mfa FROM auth_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.demo=$2 AND s.revoked_at IS NULL AND s.expires_at>$3 AND a.disabled_at IS NULL',[tokenHash(token),this.demo,now]);
  if(!session)throw new AppError(401,'SESSION_EXPIRED','Please sign in again');return {account:await this.repo.account(session.account_id),mfa:session.mfa};
 }
 async logout(token:string|undefined){if(token)await this.repo.db.query('UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1 AND demo=$2 AND revoked_at IS NULL',[tokenHash(token),this.demo]);return {signedOut:true};}
 async prune(now=new Date()){await this.repo.db.query('DELETE FROM auth_challenges WHERE expires_at<$1',[new Date(now.getTime()-86400000)]);await this.repo.db.query('DELETE FROM auth_sessions WHERE expires_at<$1 OR revoked_at<$1',[new Date(now.getTime()-30*86400000)]);}
}
