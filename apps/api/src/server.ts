import {createApp} from './app';
import {readEnv} from './config/env';
import {createDataSource} from './db/data-source';
import {loadRuntime} from './config/runtime';
async function main(){await loadRuntime();const env=readEnv(),db=createDataSource(env.DATABASE_URL,env.DATABASE_SSL==='true');await db.initialize();if(await db.showMigrations())throw new Error('Pending migrations: run the migration task before starting');const server=createApp(db,env).listen(env.PORT,'0.0.0.0',()=>console.log(`Kamraw API listening on ${env.PORT} (${env.APP_MODE})`));const stop=()=>{server.close(()=>{void db.destroy().then(()=>process.exit(0));});setTimeout(()=>process.exit(1),10000).unref();};process.once('SIGTERM',stop);process.once('SIGINT',stop);}
main().catch(()=>{console.error('Kamraw API startup failed; check configuration, database and migrations');process.exit(1);});
