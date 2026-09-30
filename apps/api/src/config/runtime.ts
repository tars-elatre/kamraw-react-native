import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';
import {z} from 'zod';
const credentials=z.object({username:z.string().regex(/^[a-z_][a-z0-9_]*$/),password:z.string().min(16)});
export async function databaseCredentials(arn:string){const client=new SecretsManagerClient({region:process.env.AWS_REGION,maxAttempts:3});try{const value=await client.send(new GetSecretValueCommand({SecretId:arn}));return credentials.parse(JSON.parse(value.SecretString??'{}'));}finally{client.destroy();}}
export function databaseUrl(value:{username:string;password:string}){const host=z.string().regex(/^[a-z0-9.-]+$/).parse(process.env.DB_HOST);const url=new URL(`postgresql://${host}:5432/kamraw`);url.username=value.username;url.password=value.password;return url.toString();}
export async function loadRuntime(){if(process.env.DB_SECRET_ARN)process.env.DATABASE_URL=databaseUrl(await databaseCredentials(process.env.DB_SECRET_ARN));}
