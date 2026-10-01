import type {MigrationInterface,QueryRunner} from 'typeorm';
export class CreatorFeedback1790797000000 implements MigrationInterface {
  name='CreatorFeedback1790797000000';
  async up(r:QueryRunner){await r.query(`
    ALTER TABLE creators ADD COLUMN verification_code text NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)) UNIQUE;
    ALTER TABLE ratings ADD COLUMN creator_id uuid REFERENCES creators,ADD COLUMN tags jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(tags)='array');
    ALTER TABLE ratings DROP CONSTRAINT ratings_session_id_rater_id_kind_key;
    UPDATE ratings f SET creator_id=c.creator_id FROM (
      SELECT session_id,(array_agg(DISTINCT creator_id))[1] AS creator_id FROM roles
      WHERE creator_id IS NOT NULL AND status NOT IN ('cancelled','refunded')
      GROUP BY session_id HAVING count(DISTINCT creator_id)=1
    ) c WHERE f.session_id=c.session_id AND f.kind='creator';
    CREATE UNIQUE INDEX ratings_recipient ON ratings(session_id,rater_id,kind,coalesce(creator_id,'00000000-0000-0000-0000-000000000000'::uuid));
    CREATE INDEX creator_ratings ON ratings(creator_id,created_at DESC);
  `);}
  async down():Promise<void>{throw new Error('Feedback and identity records are retained; use a forward migration');}
}
