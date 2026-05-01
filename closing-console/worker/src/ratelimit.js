// PIN brute-force guard backed by D1 (small table, cleaned by cron).

import { all, run } from "./db.js";

const WINDOW_MIN = 15;
const MAX_PER_TOKEN = 5;
const HARD_LOCK_PER_TOKEN_24H = 10;
const MAX_PER_IP_HOUR = 20;

function isoMinusMinutes(min) {
  return new Date(Date.now() - min * 60_000).toISOString();
}

export async function recordPinAttempt(env, token, ip, success) {
  await run(env, `INSERT INTO pin_attempts (token, ip, success) VALUES (?, ?, ?)`, token, ip || "", success ? 1 : 0);
}

export async function checkPinRate(env, token, ip) {
  const since15 = isoMinusMinutes(WINDOW_MIN);
  const since60 = isoMinusMinutes(60);
  const since1440 = isoMinusMinutes(60 * 24);
  const tokenFails = await all(env,
    `SELECT COUNT(*) AS c FROM pin_attempts WHERE token=? AND success=0 AND created_at>=?`,
    token, since15);
  if ((tokenFails[0]?.c || 0) >= MAX_PER_TOKEN) {
    return { ok: false, retryAfter: WINDOW_MIN * 60, reason: "too_many_token" };
  }
  const ipFails = await all(env,
    `SELECT COUNT(*) AS c FROM pin_attempts WHERE ip=? AND success=0 AND created_at>=?`,
    ip || "", since60);
  if ((ipFails[0]?.c || 0) >= MAX_PER_IP_HOUR) {
    return { ok: false, retryAfter: 60 * 60, reason: "too_many_ip" };
  }
  const dayFails = await all(env,
    `SELECT COUNT(*) AS c FROM pin_attempts WHERE token=? AND success=0 AND created_at>=?`,
    token, since1440);
  return { ok: true, autoRevoke: (dayFails[0]?.c || 0) >= HARD_LOCK_PER_TOKEN_24H };
}

export async function cleanupOld(env) {
  const cutoff = isoMinusMinutes(60 * 24);
  await run(env, `DELETE FROM pin_attempts WHERE created_at < ?`, cutoff);
}
