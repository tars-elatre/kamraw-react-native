import 'dotenv/config';
import {createDataSource} from './data-source';
async function main(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');const db=createDataSource(process.env.DATABASE_URL,process.env.DATABASE_SSL==='true');await db.initialize();try{const result=await db.runMigrations({transaction:'all'});console.log(`Applied ${result.length} migrations`);}finally{await db.destroy();}}
main().catch(()=>{console.error('Migration failed; inspect database and configuration');process.exit(1);});
