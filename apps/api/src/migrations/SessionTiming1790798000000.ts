import type {MigrationInterface,QueryRunner} from 'typeorm';
export class SessionTiming1790798000000 implements MigrationInterface {
  name='SessionTiming1790798000000';
  async up(r:QueryRunner){await r.query(`
    ALTER TABLE sessions ADD COLUMN venue_allows_overrun boolean NOT NULL DEFAULT true;
    ALTER TABLE roles ADD COLUMN checked_in_at timestamptz,ADD COLUMN actual_started_at timestamptz,
      ADD COLUMN actual_completed_at timestamptz,ADD COLUMN service_end_at timestamptz,
      ADD COLUMN late boolean NOT NULL DEFAULT false,ADD COLUMN overrun_conflict boolean NOT NULL DEFAULT false;
    UPDATE roles r SET checked_in_at=(SELECT min(device_at) FROM session_events e WHERE e.payload->>'roleId'=r.id::text AND e.kind='check_in'),
      actual_started_at=(SELECT min(device_at) FROM session_events e WHERE e.payload->>'roleId'=r.id::text AND e.kind='start'),
      actual_completed_at=(SELECT max(device_at) FROM session_events e WHERE e.payload->>'roleId'=r.id::text AND e.kind='complete');
    UPDATE roles r SET service_end_at=s.end_at FROM sessions s WHERE s.id=r.session_id;
    CREATE VIEW role_occupancy AS SELECT r.*,greatest(r.reserved_end,r.service_end_at+interval '30 minutes') AS occupied_until FROM roles r;
    CREATE TABLE completion_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),role_id uuid NOT NULL REFERENCES roles,
      actor_id uuid NOT NULL REFERENCES accounts,client_id uuid NOT NULL,requested_at timestamptz NOT NULL,
      available_after timestamptz NOT NULL,location jsonb, status text NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','disputed','confirmed','auto_completed','dismissed','staff_completed')),
      reason text NOT NULL DEFAULT '',reviewed_by uuid REFERENCES accounts,resolved_at timestamptz,
      UNIQUE(actor_id,client_id));
    CREATE UNIQUE INDEX one_open_completion ON completion_requests(role_id) WHERE status IN ('pending','disputed');
    CREATE INDEX completion_role_history ON completion_requests(role_id,requested_at DESC);
    CREATE INDEX due_completion ON completion_requests(available_after) WHERE status='pending';
  `);}
  async down():Promise<void>{throw new Error('Arrival, compensation and completion evidence is retained; use a forward migration');}
}
