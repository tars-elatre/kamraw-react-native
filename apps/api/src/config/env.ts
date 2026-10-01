import 'dotenv/config';
import { z } from 'zod';
const schema=z.object({NODE_ENV:z.enum(['development','test','production']).default('development'),APP_MODE:z.enum(['demo','live']).default('live'),PORT:z.coerce.number().default(4000),DATABASE_URL:z.string().min(1),DATABASE_SSL:z.enum(['true','false']).default('false'),CORS_ORIGINS:z.string().optional(),WEB_ORIGIN:z.string().url().default('http://localhost:5173'),PUBLIC_API_URL:z.string().url().default('http://localhost:4000'),MEDIA_ROOT:z.string().default('../../.local/media'),PAYMENT_WEBHOOK_SECRET:z.string().min(32).optional()});
export type Env=z.infer<typeof schema>;
export function readEnv():Env {const env=schema.parse(process.env);if(env.NODE_ENV==='production'&&env.APP_MODE==='live'&&(!env.DATABASE_SSL||env.DATABASE_SSL==='false'||!env.PUBLIC_API_URL.startsWith('https:')))throw new Error('Live production requires PostgreSQL TLS and HTTPS');return env;}
