import type {RequestHandler,Request} from 'express';
import {auth} from 'express-oauth2-jwt-bearer';
import {AccountEntity,type Account} from '../entities';
import type {PlatformRepository} from '../repositories/platform';
import type {Env} from '../config/env';
import {AppError} from './errors';
export interface Principal {account:Account;mfa:boolean}
declare module 'express-serve-static-core' {interface Request {principal?:Principal}}
export const permissions:Record<string,string[]>={
  super_admin:['privacy','config:read','operations','dispatch','onboarding','qc','support','finance','payout:create','payout:approve','config:write','config:approve','audit','reports'],
  city_ops:['config:read','operations','dispatch','onboarding','support','config:write','reports'],dispatcher:['operations','dispatch'],verifier:['onboarding'],qc:['qc'],support:['support'],finance:['finance','payout:create'],finance_approver:['config:read','finance','payout:approve','config:approve'],marketing:['content'],analyst:['reports']
};
export const principal=(req:Request)=>{if(!req.principal)throw new AppError(401,'LOGIN_REQUIRED','Please sign in');return req.principal;};
export function permit(permission:string):RequestHandler{return (req,_res,next)=>{const p=principal(req);if(!p.mfa||!permissions[p.account.role]?.includes(permission))throw new AppError(403,'FORBIDDEN','This action requires the appropriate staff role and MFA');next();};}
export function authentication(env:Env,repo:PlatformRepository):RequestHandler[]{
  if(env.APP_MODE==='demo')return [async(req,_res,next)=>{const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token?.startsWith('demo:'))throw new AppError(401,'LOGIN_REQUIRED','Choose a demo account to continue');const subject=token.slice(5);const account=await repo.db.getRepository(AccountEntity).findOneBy({subject:`demo:${subject}`});if(!account)throw new AppError(401,'LOGIN_REQUIRED','Unknown demo account');const [state]=await repo.db.query('SELECT disabled_at FROM accounts WHERE id=$1',[account.id]);if(state?.disabled_at)throw new AppError(401,'ACCOUNT_CLOSED','This account has been closed');req.principal={account,mfa:true};next();}];
  return [auth({tokenSigningAlg:'RS256'}),async(req,_res,next)=>{const payload=req.auth?.payload,subject=payload?.sub;if(typeof subject!=='string')throw new AppError(401,'LOGIN_REQUIRED','Invalid identity');let account=await repo.db.getRepository(AccountEntity).findOneBy({subject});if(!account){await repo.db.getRepository(AccountEntity).upsert({subject,name:'Kamraw customer',role:'customer',language:'en',consents:{}},['subject']);account=await repo.db.getRepository(AccountEntity).findOneByOrFail({subject});}const [state]=await repo.db.query('SELECT disabled_at FROM accounts WHERE id=$1',[account.id]);if(state?.disabled_at)throw new AppError(401,'ACCOUNT_CLOSED','This account has been closed');req.principal={account,mfa:Array.isArray(payload?.amr)&&payload.amr.includes('mfa')};next();}];
}
