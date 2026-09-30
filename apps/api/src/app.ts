import express from 'express';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import {rateLimit} from 'express-rate-limit';
import {randomUUID} from 'node:crypto';
import type {DataSource} from 'typeorm';
import type {Env} from './config/env';
import {PlatformRepository} from './repositories/platform';
import {routes,webhook} from './routes/platform';
import {errorHandler} from './middleware/errors';
export function createApp(db:DataSource,env:Env){const app=express(),repo=new PlatformRepository(db);app.disable('x-powered-by');app.set('trust proxy','loopback');app.use(helmet());app.use(cors({origin:[env.WEB_ORIGIN,...(env.CORS_ORIGINS?.split(',').filter(Boolean)??[])],methods:['GET','POST','PUT','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization']}));app.use((_req,res,next)=>{res.setHeader('X-Request-Id',randomUUID());next();});
  app.get('/health',(_req,res)=>res.json({status:'ok',service:'kamraw-api',mode:env.APP_MODE}));app.get('/ready',async(_req,res)=>{try{await db.query('SELECT 1');res.json({status:'ready'});}catch{res.status(503).json({status:'unavailable'});}});
  app.post('/webhooks/payment',rateLimit({windowMs:60000,limit:60}),express.raw({type:'application/json',limit:'64kb'}),webhook(repo,env));app.use(express.json({limit:'256kb'}));app.use('/api',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false}),routes(repo,env));if(process.env.MOBILE_WEB_ROOT){const mobile=path.resolve(process.env.MOBILE_WEB_ROOT);app.get(['/app','/app/{*path}'],(_req,res)=>res.sendFile(path.join(mobile,'index.html')));app.use('/_expo',express.static(path.join(mobile,'_expo')));app.use('/assets',express.static(path.join(mobile,'assets'))); }if(process.env.WEB_ROOT){const root=path.resolve(process.env.WEB_ROOT);app.use(express.static(root));app.get(['/','/g/:token'],(_req,res)=>res.sendFile(path.join(root,'index.html'))); }app.use((_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'This endpoint does not exist'}}));app.use(errorHandler);return app;}
