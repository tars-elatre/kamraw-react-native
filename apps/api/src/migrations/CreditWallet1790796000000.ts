import type {MigrationInterface,QueryRunner} from 'typeorm';
export class CreditWallet1790796000000 implements MigrationInterface {
  name='CreditWallet1790796000000';
  async up(r:QueryRunner){await r.query(`
    ALTER TABLE orders ADD COLUMN credit_paise int NOT NULL DEFAULT 0 CHECK(credit_paise>=0);
    ALTER TABLE sessions ADD COLUMN credit_paise int NOT NULL DEFAULT 0 CHECK(credit_paise>=0);
    ALTER TABLE refunds ADD COLUMN credit_paise int NOT NULL DEFAULT 0 CHECK(credit_paise>=0 AND credit_paise<=amount_paise);
    ALTER TABLE session_changes ADD COLUMN credit_refund_paise int NOT NULL DEFAULT 0 CHECK(credit_refund_paise>=0);
    ALTER TABLE customer_credits ADD COLUMN expires_at timestamptz;
    CREATE TABLE credit_redemptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),credit_id uuid NOT NULL REFERENCES customer_credits,order_id uuid NOT NULL REFERENCES orders,amount_paise int NOT NULL CHECK(amount_paise>0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(credit_id,order_id));
    CREATE INDEX credit_redemptions_order ON credit_redemptions(order_id);
  `);}
  async down():Promise<void>{throw new Error('Credit ledger history must be retained; use a forward migration');}
}
