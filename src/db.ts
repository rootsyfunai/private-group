import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } });

export async function initializeDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      invoice_id TEXT PRIMARY KEY,
      telegram_user_id BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS memberships (
      telegram_user_id BIGINT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS join_requests (
      telegram_user_id BIGINT PRIMARY KEY,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stars_payments (
      charge_id TEXT PRIMARY KEY,
      telegram_user_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function recordInvoice(invoiceId: string, userId: number): Promise<void> {
  await pool.query(
    "INSERT INTO payments (invoice_id, telegram_user_id) VALUES ($1, $2) ON CONFLICT (invoice_id) DO NOTHING",
    [invoiceId, userId],
  );
}

export async function markPaid(invoiceId: string): Promise<number | null> {
  const result = await pool.query<{ telegram_user_id: string }>(
    `UPDATE payments SET status = 'paid', paid_at = NOW()
     WHERE invoice_id = $1 AND status = 'active'
     RETURNING telegram_user_id`,
    [invoiceId],
  );
  return result.rows[0] ? Number(result.rows[0].telegram_user_id) : null;
}

export async function upsertMembership(userId: number, days: number): Promise<Date> {
  const result = await pool.query<{ expires_at: Date }>(
    `INSERT INTO memberships (telegram_user_id, expires_at)
     VALUES ($1, NOW() + ($2 * INTERVAL '1 day'))
     ON CONFLICT (telegram_user_id) DO UPDATE
       SET expires_at = GREATEST(memberships.expires_at, NOW()) + ($2 * INTERVAL '1 day'),
           active = TRUE
     RETURNING expires_at`,
    [userId, days],
  );
  return result.rows[0].expires_at;
}

export async function recordStarsPayment(chargeId: string, userId: number): Promise<boolean> {
  const result = await pool.query(
    "INSERT INTO stars_payments (charge_id, telegram_user_id) VALUES ($1, $2) ON CONFLICT (charge_id) DO NOTHING",
    [chargeId, userId],
  );
  return result.rowCount === 1;
}

export async function activeMembership(userId: number): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM memberships WHERE telegram_user_id = $1 AND active = TRUE AND expires_at > NOW()",
    [userId],
  );
  return result.rowCount === 1;
}

export async function recordJoinRequest(userId: number): Promise<void> {
  await pool.query(
    "INSERT INTO join_requests (telegram_user_id) VALUES ($1) ON CONFLICT (telegram_user_id) DO NOTHING",
    [userId],
  );
}

export async function expiredMemberships(): Promise<number[]> {
  const result = await pool.query<{ telegram_user_id: string }>(
    `UPDATE memberships SET active = FALSE
     WHERE active = TRUE AND expires_at <= NOW()
     RETURNING telegram_user_id`,
  );
  return result.rows.map((row) => Number(row.telegram_user_id));
}
