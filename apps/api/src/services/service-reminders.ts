import {PlatformRepository} from '../repositories/platform';

interface DueRole {id:string;session_id:string;status:string;discipline:string;start_at:Date;end_at:Date;completed_at:Date|null;dispatch_started_at:Date;assigned_at:Date|null;mode:string}
export class ServiceReminders {
  constructor(private repo:PlatformRepository){}
  async tick(now=new Date()){
    return this.repo.db.transaction(async m=>{
      const [lock]=await m.query("SELECT pg_try_advisory_xact_lock(hashtext('kamraw-service-reminders')) AS locked");if(!lock.locked)return;
      const roles=await m.query(`SELECT r.id,r.session_id,r.status,r.discipline,r.dispatch_started_at,r.assigned_at,s.start_at,s.end_at,s.completed_at,s.input->>'mode' AS mode
        FROM roles r JOIN sessions s ON s.id=r.session_id WHERE r.status IN ('confirmed','assigned','reconfirmed','en_route','in_session','session_completed')
        ORDER BY s.start_at LIMIT 1000`) as DueRole[];
      for(const role of roles){
        const cycle=role.assigned_at??role.dispatch_started_at;
        const emit=async(kind:string)=>{
          const rows=await m.query('INSERT INTO service_reminders(role_id,kind,cycle,sent_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[role.id,kind,cycle,now]);
          if(rows.length)await this.repo.event(m,kind,role.id,{sessionId:role.session_id});
        };
        const minutesToStart=(role.start_at.getTime()-now.getTime())/60000;
        if(role.status==='confirmed'){
          const age=(now.getTime()-role.dispatch_started_at.getTime())/60000;
          if(age>=(role.mode==='on_demand'?10:360))await emit('assignment_overdue');
          if(role.mode==='on_demand'&&age>=15){
            await m.query("INSERT INTO service_failures(session_id,role_id,kind,credit_paise) VALUES($1,$2,'assignment_delayed',0) ON CONFLICT(role_id,kind) DO NOTHING",[role.session_id,role.id]);
            await emit('assignment_choice');
          }
        }
        if(role.status==='assigned'&&role.mode==='scheduled'&&minutesToStart<=1440&&minutesToStart>0){
          await emit('reconfirmation_due');
          const [prompt]=await m.query("SELECT sent_at FROM service_reminders WHERE role_id=$1 AND kind='reconfirmation_due' AND cycle=$2",[role.id,cycle]);
          if(prompt&&now.getTime()-new Date(prompt.sent_at).getTime()>=2*3600000)await emit('reconfirmation_overdue');
        }
        if(['assigned','reconfirmed'].includes(role.status)&&minutesToStart>0){
          if(role.mode==='on_demand'&&role.assigned_at&&now.getTime()-role.assigned_at.getTime()>=15*60000||role.mode==='scheduled'&&minutesToStart<=95)await emit('departure_due');
        }
        if(['assigned','reconfirmed','en_route'].includes(role.status)&&minutesToStart<=-10)await emit('late_risk');
        if(role.status==='in_session'&&role.end_at>now&&role.end_at.getTime()-now.getTime()<=15*60000)await emit('session_ending');
        if(role.status==='session_completed'&&role.discipline==='photo'&&role.completed_at&&now.getTime()-role.completed_at.getTime()>=24*3600000)await emit('upload_overdue');
      }
    });
  }
}
