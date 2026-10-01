import type {MigrationInterface,QueryRunner} from 'typeorm';
export class PrintFulfilment1790793000000 implements MigrationInterface {
 name='PrintFulfilment1790793000000';
 async up(r:QueryRunner){await r.query(`ALTER TABLE print_orders ADD COLUMN proof_version int NOT NULL DEFAULT 0,ADD COLUMN proof_approved_at timestamptz,ADD COLUMN tracking jsonb NOT NULL DEFAULT '{}',ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();`);}
 async down():Promise<void>{throw new Error('Print orders retain their approval history; use a forward migration');}
}
