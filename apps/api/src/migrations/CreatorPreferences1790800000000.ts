import type {MigrationInterface,QueryRunner} from 'typeorm';
export class CreatorPreferences1790800000000 implements MigrationInterface {
 name='CreatorPreferences1790800000000';
 async up(r:QueryRunner){await r.query(`
CREATE TABLE preference_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),role_id uuid UNIQUE NOT NULL REFERENCES roles,
 creator_id uuid NOT NULL REFERENCES creators,unmet jsonb NOT NULL CHECK(jsonb_typeof(unmet)='array'),
 accepted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO preference_reviews(role_id,creator_id,unmet)
 SELECT r.id,c.id,
   CASE WHEN s.input->'preferences'->>'language' IS NOT NULL AND NOT(c.languages ? (s.input->'preferences'->>'language')) THEN '["language"]'::jsonb ELSE '[]'::jsonb END ||
   CASE WHEN s.input->'preferences'->>'femaleCreator'='true' AND coalesce(c.profile->>'gender','')<>'female' THEN '["femaleCreator"]'::jsonb ELSE '[]'::jsonb END
 FROM roles r JOIN sessions s ON s.id=r.session_id JOIN creators c ON c.id=r.creator_id
 WHERE r.status IN ('assigned','reconfirmed','en_route','arrived');
INSERT INTO outbox(kind,entity_id,payload)
 SELECT DISTINCT 'preferences_unmet',r.session_id::text,'{}'::jsonb FROM preference_reviews p JOIN roles r ON r.id=p.role_id WHERE jsonb_array_length(p.unmet)>0;
`);}
 async down():Promise<void>{throw new Error('Preference decisions contain customer consent history; restore a verified backup instead');}
}
