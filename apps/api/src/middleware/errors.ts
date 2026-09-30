import type {ErrorRequestHandler} from 'express';
import {ZodError} from 'zod';
export class AppError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export function requireValue<T>(value:T|null|undefined,message='Not found'):T {if(value==null)throw new AppError(404,'NOT_FOUND',message);return value;}
export const errorHandler:ErrorRequestHandler=(err,_req,res,_next)=>{
  if(err instanceof ZodError){res.status(422).json({error:{code:'VALIDATION',message:'Check the highlighted information',fields:err.flatten()}});return;}
  if(err instanceof AppError){res.status(err.status).json({error:{code:err.code,message:err.message}});return;}
  if(err?.code==='23P01'||err?.code==='23505'){res.status(409).json({error:{code:'CONFLICT',message:'This item has changed or is already reserved. Refresh and try again.'}});return;}
  if(err?.status===401||err?.status===403){res.status(err.status).json({error:{code:'UNAUTHORIZED',message:'Please sign in with an authorized account'}});return;}
  res.status(500).json({error:{code:'INTERNAL',message:'We could not complete this request. Please try again.'}});
};
