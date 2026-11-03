import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: false } });

export async function initializeDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      telegram_user_id BIGINT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE IF NOT EXISTS join_requests (
      telegram_user_id BIGINT PRIMARY KEY,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wallet_payments (
      tx_hash TEXT PRIMARY KEY,
      telegram_user_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS previews (
      telegram_user_id BIGINT PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      removed BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS referrals (
      referred_user_id BIGINT PRIMARY KEY,
      referrer_user_id BIGINT NOT NULL,
      rewarded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
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

export async function recordWalletPayment(txHash: string, userId: number): Promise<boolean> {
  const result = await pool.query(
    "INSERT INTO wallet_payments (tx_hash, telegram_user_id) VALUES ($1, $2) ON CONFLICT (tx_hash) DO NOTHING",
    [txHash.toLowerCase(), userId],
  );
  return result.rowCount === 1;
}

export async function startPreview(userId: number, minutes: number): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO previews (telegram_user_id, expires_at)
     VALUES ($1, NOW() + ($2 * INTERVAL '1 minute'))
     ON CONFLICT (telegram_user_id) DO UPDATE
       SET started_at = NOW(),
           expires_at = NOW() + ($2 * INTERVAL '1 minute'),
           removed = FALSE
     WHERE previews.started_at <= NOW() - INTERVAL '1 day'
     RETURNING telegram_user_id`,
    [userId, minutes],
  );
  return result.rowCount === 1;
}

export async function expiredPreviews(): Promise<number[]> {
  const result = await pool.query<{ telegram_user_id: string }>(
    `UPDATE previews SET removed = TRUE
     WHERE removed = FALSE AND expires_at <= NOW()
     RETURNING telegram_user_id`,
  );
  return result.rows.map((row) => Number(row.telegram_user_id));
}

export async function recordReferral(referredUserId: number, referrerUserId: number): Promise<boolean> {
  if (referredUserId === referrerUserId) return false;
  const result = await pool.query(
    "INSERT INTO referrals (referred_user_id, referrer_user_id) VALUES ($1, $2) ON CONFLICT (referred_user_id) DO NOTHING",
    [referredUserId, referrerUserId],
  );
  return result.rowCount === 1;
}

export async function claimReferralReward(referredUserId: number): Promise<number | null> {
  const result = await pool.query<{ referrer_user_id: string }>(
    `UPDATE referrals SET rewarded = TRUE
     WHERE referred_user_id = $1 AND rewarded = FALSE
     RETURNING referrer_user_id`,
    [referredUserId],
  );
  return result.rows[0] ? Number(result.rows[0].referrer_user_id) : null;
}

export async function referralCount(userId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM referrals WHERE referrer_user_id = $1 AND rewarded = TRUE",
    [userId],
  );
  return Number(result.rows[0].count);
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
