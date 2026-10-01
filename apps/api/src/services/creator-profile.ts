import sharp from 'sharp';
import {PlatformRepository} from '../repositories/platform';
import {CreatorEntity,type Creator} from '../entities';
import {AppError} from '../middleware/errors';

export class CreatorProfileService {
  constructor(private repo:PlatformRepository,private demo:boolean){}
  async statistics(creatorId:string){
    const [stats]=await this.repo.db.query(`SELECT
      (SELECT count(DISTINCT r.session_id)::int FROM roles r JOIN sessions s ON s.id=r.session_id WHERE r.creator_id=$1 AND s.completed_at IS NOT NULL AND r.status NOT IN ('cancelled','refunded')) AS completed_jobs,
      (SELECT count(*)::int FROM offers WHERE creator_id=$1 AND status='accepted') AS accepted_offers,
      (SELECT count(*)::int FROM offers WHERE creator_id=$1 AND status IN ('accepted','declined','expired')) AS decided_offers,
      (SELECT count(*)::int FROM creator_cancellations WHERE creator_id=$1 AND created_at>now()-interval '90 days') AS cancellations_90_days,
      (SELECT count(*)::int FROM media_assets a JOIN uploads u ON u.id=a.upload_id WHERE u.creator_id=$1 AND a.kind='edited' AND a.qc_status='approved') AS approved_files,
      (SELECT count(*)::int FROM media_assets a JOIN uploads u ON u.id=a.upload_id WHERE u.creator_id=$1 AND a.kind='edited' AND a.qc_status IN ('approved','rejected')) AS reviewed_files`,[creatorId]);
    const [rating]=await this.repo.db.query(`SELECT avg(stars)::float AS average,count(*)::int AS count FROM (
      SELECT f.stars FROM ratings f WHERE f.kind='creator' AND f.creator_id=$1 ORDER BY f.created_at DESC,f.id DESC LIMIT 20
    ) recent`,[creatorId]);
    return {...stats,rating:rating.average,rating_count:rating.count,review:rating.average===null?'no_ratings':rating.average<4?'suspension_review':rating.average<4.2?'improvement_review':'within_standard'};
  }
  private async card(c:Creator){
    const [identity]=await this.repo.db.query('SELECT verification_code FROM creators WHERE id=$1',[c.id]),stats=await this.statistics(c.id);
    const gear=Array.isArray(c.profile.gear)?c.profile.gear.filter((g:unknown):g is {type:string;model:string}=>!!g&&typeof g==='object'&&'model' in g&&typeof g.model==='string'&&'type' in g&&typeof g.type==='string').map(g=>({type:g.type,model:g.model})):[];
    return {id:c.id,name:c.name.trim().split(/\s+/)[0],status:c.status,languages:c.languages,disciplines:c.disciplines,
      bio:typeof c.profile.bio==='string'?c.profile.bio:'',gear,
      portfolioUrls:Array.isArray(c.profile.portfolioUrls)?c.profile.portfolioUrls.filter((url:unknown)=>typeof url==='string'&&url.startsWith('https://')):[],
      photo:typeof c.profile.photoDataUrl==='string'&&c.profile.photoDataUrl.startsWith('data:image/jpeg;base64,')?c.profile.photoDataUrl:null,
      verificationCode:identity.verification_code,completedJobs:stats.completed_jobs,rating:stats.rating,ratingCount:stats.rating_count,demo:this.demo};
  }
  async self(accountId:string){const c=await this.repo.creator(accountId);return {profile:await this.card(c),statistics:await this.statistics(c.id)};}
  async assigned(accountId:string,sessionId:string){
    await this.repo.authorizedSession(sessionId,accountId);
    const roles=await this.repo.db.query("SELECT id,creator_id,discipline,tier FROM roles WHERE session_id=$1 AND creator_id IS NOT NULL AND status NOT IN ('cancelled','refunded')",[sessionId]);
    return Promise.all(roles.map(async(r:{id:string;creator_id:string;discipline:string;tier:string})=>({...await this.card(await this.repo.db.getRepository(CreatorEntity).findOneByOrFail({id:r.creator_id})),roleId:r.id,discipline:r.discipline,tier:r.tier})));
  }
  async photo(accountId:string,bytes:Buffer){
    const c=await this.repo.creator(accountId);
    if(!this.demo&&c.status==='active')throw new AppError(409,'PHOTO_REVIEW_REQUIRED','Operations must review changes to an active creator’s profile photo');
    if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>4*1024**2)throw new AppError(422,'PHOTO_SIZE','Choose an image smaller than 4 MB');
    let image:Buffer;
    try{const source=sharp(bytes,{limitInputPixels:25000000}),meta=await source.metadata();if(!['jpeg','png','webp'].includes(meta.format??'')||(meta.pages??1)>1)throw new Error('Unsupported photo');image=await source.rotate().resize(512,512,{fit:'cover',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();}catch{throw new AppError(422,'PHOTO_FORMAT','Choose a valid JPEG, PNG or WebP profile photo');}
    await this.repo.db.transaction(async m=>{await m.query("UPDATE creators SET profile=jsonb_set(profile,'{photoDataUrl}',to_jsonb($2::text)) WHERE id=$1",[c.id,`data:image/jpeg;base64,${image.toString('base64')}`]);await this.repo.audit(m,accountId,'creator_profile_photo_updated',c.id,{demo:this.demo});});
    return {saved:true};
  }
}
