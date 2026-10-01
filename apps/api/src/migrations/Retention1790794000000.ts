import type {MigrationInterface,QueryRunner} from 'typeorm';
export class Retention1790794000000 implements MigrationInterface {
 name='Retention1790794000000';
 async up(r:QueryRunner){await r.query(`ALTER TABLE galleries ADD COLUMN final_delivered_at timestamptz;ALTER TABLE privacy_requests ADD COLUMN reviewed_by uuid REFERENCES accounts,ADD COLUMN review_note text,ADD COLUMN completed_at timestamptz;ALTER TABLE accounts ADD COLUMN disabled_at timestamptz;`);}
 async down():Promise<void>{throw new Error('Retention history requires a forward migration');}
}
