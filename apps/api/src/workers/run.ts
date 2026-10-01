import {drainDemoOutbox} from '../services/demo-providers';
import {loadRuntime} from '../config/runtime';
import {readEnv} from '../config/env';
import {createDataSource} from '../db/data-source';
import {PlatformRepository} from '../repositories/platform';
import {RecoveryService} from '../services/recovery';
import {DispatchService} from '../services/dispatch';
export async function tick(repo:PlatformRepository){await new RecoveryService(repo).detectNoShows();const roles=await repo.db.query("SELECT id FROM roles WHERE creator_id IS NULL AND status='confirmed' LIMIT 100") as {id:string}[];const dispatch=new DispatchService(repo);for(const r of roles)await dispatch.dispatch(r.id);if(process.env.APP_MODE==='demo')await drainDemoOutbox(repo);await repo.db.query("UPDATE session_changes SET status='expired' WHERE status='pending' AND expires_at<=now()");await repo.db.query("DELETE FROM locations WHERE created_at<now()-interval '90 days'");}
async function main(){await loadRuntime();const env=readEnv(),db=createDataSource(env.DATABASE_URL,env.DATABASE_SSL==='true');await db.initialize();const repo=new PlatformRepository(db);let running=false;const interval=setInterval(()=>{if(running)return;running=true;void tick(repo).catch(()=>console.error('Worker tick failed')).finally(()=>{running=false;});},10000);process.once('SIGTERM',()=>{clearInterval(interval);void db.destroy();});await tick(repo);}
if(require.main===module)void main().catch(()=>{console.error('Worker startup failed');process.exit(1);});
