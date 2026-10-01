import {rm} from 'node:fs/promises';
import path from 'node:path';
import {PlatformRepository} from '../repositories/platform';
export class RetentionService {
 constructor(private repo:PlatformRepository,private root:string){}
 async tick(now=new Date()){
  await this.repo.db.transaction(async m=>{await m.query("SELECT pg_advisory_xact_lock(hashtext('retention'))");const galleries=await m.query("SELECT id,expires_at FROM galleries WHERE status IN ('preview_ready','final_ready') AND expires_at IS NOT NULL");for(const g of galleries){const days=(new Date(g.expires_at).getTime()-now.getTime())/86400000;for(const threshold of [days<=1?1:days<=7?7:30]){if(days>threshold||days<=0)continue;const kind=`gallery_expiry_${threshold}`;const [sent]=await m.query('SELECT id FROM outbox WHERE kind=$1 AND entity_id=$2',[kind,g.id]);if(!sent)await this.repo.event(m,kind,g.id,{expiresAt:g.expires_at});}if(days<=0){await m.query("UPDATE galleries SET status='expired' WHERE id=$1",[g.id]);await m.query('UPDATE shares SET revoked_at=coalesce(revoked_at,$2) WHERE gallery_id=$1',[g.id,now]);await this.repo.event(m,'gallery_expired',g.id);}}
   await m.query("UPDATE media_assets SET status='expired' WHERE status IN ('verified','uploading','pending','checksum_failed') AND gallery_id IN(SELECT id FROM galleries WHERE status='expired')");
   await m.query("UPDATE media_assets a SET status='expired' FROM uploads u,sessions s,galleries g WHERE a.upload_id=u.id AND u.session_id=s.id AND a.gallery_id=g.id AND a.kind='original' AND a.status='verified' AND g.final_delivered_at IS NOT NULL AND NOT (s.input->'addons' ? 'Raw files') AND ((a.filename !~* '\\.(mp4|mov|wav)$' AND g.final_delivered_at<$1) OR (a.filename ~* '\\.(mp4|mov|wav)$' AND g.final_delivered_at<$2))",[new Date(now.getTime()-30*86400000),new Date(now.getTime()-90*86400000)]);
  });
  const expired=await this.repo.db.query("SELECT id,storage_key FROM media_assets WHERE status IN ('expired','discarded') LIMIT 100");for(const a of expired){if(!/^[a-f0-9]{40}$/.test(a.storage_key))throw new Error('Invalid storage key');for(const area of ['primary','backup','preview'])await rm(path.join(this.root,area,a.storage_key+(area==='preview'?'.jpg':'')),{force:true});await this.repo.db.query("UPDATE media_assets SET status='purged',copies=0,filename='removed' WHERE id=$1 AND status IN ('expired','discarded')",[a.id]);}
 }
}
