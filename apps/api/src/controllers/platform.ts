import type {Request,RequestHandler} from 'express';
import {z} from 'zod';
export const id=(req:Request,key='id')=>z.uuid().parse(req.params[key]);
export const page=(req:Request)=>z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
export function respond(action:(req:Request)=>Promise<unknown>,status=200):RequestHandler {return async(req,res)=>{res.status(status).json({data:await action(req)});};}
