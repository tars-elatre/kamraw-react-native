import type {MigrationInterface,QueryRunner} from 'typeorm';
export class Notifications1790791000000 implements MigrationInterface {
 name='Notifications1790791000000';
 async up(r:QueryRunner){await r.query(`CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts,event_id uuid NOT NULL REFERENCES outbox,title text NOT NULL,body text NOT NULL,entity_id text NOT NULL,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_id,event_id));CREATE INDEX account_notifications ON notifications(account_id,created_at DESC);`);}
 async down():Promise<void>{throw new Error('Notification history is retained; use a forward migration');}
}
