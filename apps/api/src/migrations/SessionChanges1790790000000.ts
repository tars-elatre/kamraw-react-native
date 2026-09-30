import type {MigrationInterface,QueryRunner} from 'typeorm';
export class SessionChanges1790790000000 implements MigrationInterface {
  name='SessionChanges1790790000000';
  async up(r:QueryRunner):Promise<void>{await r.query(`
CREATE TABLE session_changes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),session_id uuid NOT NULL REFERENCES sessions,
 customer_id uuid NOT NULL REFERENCES accounts,kind text NOT NULL CHECK(kind IN ('reschedule','extension')),
 status text NOT NULL DEFAULT 'pending',data jsonb NOT NULL,delta_paise int NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),applied_at timestamptz);
CREATE INDEX session_change_history ON session_changes(session_id,created_at DESC);
CREATE UNIQUE INDEX one_pending_session_change ON session_changes(session_id) WHERE status='pending';
CREATE TABLE extension_responses(change_id uuid NOT NULL REFERENCES session_changes,role_id uuid NOT NULL REFERENCES roles,
 creator_id uuid NOT NULL REFERENCES creators,accepted boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(change_id,role_id));
`);}
  async down():Promise<void>{throw new Error('Session changes contain financial history; restore a verified backup instead');}
}
