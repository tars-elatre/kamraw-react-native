import type {EntityManager} from 'typeorm';
import {RoleEntity,SessionEntity} from '../entities';
import type {Status} from '@kamraw/domain';
// Uploading can begin for one creator while another is still finishing the shoot.
const ladder:Status[]=['confirmed','assigned','reconfirmed','en_route','arrived','in_session','session_completed','media_verified','editing','preview_delivered','final_delivered','closed'];
export async function refreshSessionState(m:EntityManager,sessionId:string,when:Date){
  const roles=(await m.getRepository(RoleEntity).findBy({sessionId})).filter(r=>!['cancelled','refunded'].includes(r.status));
  if(!roles.length||roles.some(r=>!ladder.includes(r.status)))return;
  const status=ladder[Math.min(...roles.map(r=>ladder.indexOf(r.status)))]!;
  const session=await m.getRepository(SessionEntity).findOneByOrFail({id:sessionId});
  await m.getRepository(SessionEntity).update(sessionId,{status,...(ladder.indexOf(status)>=5&&!session.startedAt?{startedAt:when}:{}),...(ladder.indexOf(status)>=6&&!session.completedAt?{completedAt:when}:{})});
}
