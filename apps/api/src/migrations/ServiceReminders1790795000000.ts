import type {MigrationInterface,QueryRunner} from 'typeorm';
export class ServiceReminders1790795000000 implements MigrationInterface {
  name='ServiceReminders1790795000000';
  async up(r:QueryRunner){await r.query(`
    ALTER TABLE roles ADD COLUMN dispatch_started_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN assigned_at timestamptz;
    CREATE TABLE service_reminders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),role_id uuid NOT NULL REFERENCES roles,kind text NOT NULL,cycle timestamptz NOT NULL,sent_at timestamptz NOT NULL DEFAULT now(),UNIQUE(role_id,kind,cycle));
    CREATE INDEX reminders_role_time ON service_reminders(role_id,sent_at);
  `);}
  async down():Promise<void>{throw new Error('Reminder history is retained; use a forward migration');}
}
