'use strict';

const db = require('./db');
const { getCoupon } = require('./pricing');

const DAY_MS = 24 * 60 * 60 * 1000;

const REASONS = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_USED: 'ALREADY_USED',
  SOLD_OUT: 'SOLD_OUT',
  NO_SUBSCRIPTION: 'NO_SUBSCRIPTION',
  WRONG_TIER: 'WRONG_TIER',
  LIFETIME_NOT_ELIGIBLE: 'LIFETIME_NOT_ELIGIBLE',
  COUPON_ALREADY_REDEEMED: 'COUPON_ALREADY_REDEEMED',
});

function redeemCoupon(telegramId, rawCode) {
  if (!Number.isSafeInteger(Number(telegramId))) {
    return { ok: false, reason: REASONS.NOT_FOUND };
  }

  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  const coupon = getCoupon(code);
  if (!coupon) return { ok: false, reason: REASONS.NOT_FOUND };

  const tx = db.transaction(() => {
    // All reads that determine eligibility and the write are in one transaction.
    // This prevents two concurrent redemptions from both passing the checks.
    const alreadyUsed = db
      .prepare('SELECT 1 FROM redemptions WHERE code = ? AND telegram_id = ? LIMIT 1')
      .get(code, telegramId);
    if (alreadyUsed) return { ok: false, reason: REASONS.ALREADY_USED };

    const priorRedemption = db
      .prepare('SELECT 1 FROM redemptions WHERE telegram_id = ? LIMIT 1')
      .get(telegramId);
    if (priorRedemption) return { ok: false, reason: REASONS.COUPON_ALREADY_REDEEMED };

    if (coupon.maxRedemptions !== null && coupon.maxRedemptions !== undefined) {
      const { n } = db
        .prepare('SELECT COUNT(*) AS n FROM redemptions WHERE code = ?')
        .get(code);
      if (n >= coupon.maxRedemptions) return { ok: false, reason: REASONS.SOLD_OUT };
    }

    const sub = db
      .prepare("SELECT * FROM subscriptions WHERE telegram_id = ? AND status = 'ACTIVE'")
      .get(telegramId);
    if (!sub) return { ok: false, reason: REASONS.NO_SUBSCRIPTION };

    if (!coupon.eligibleTiers.includes(sub.tier)) {
      return { ok: false, reason: REASONS.WRONG_TIER };
    }

    if (sub.active_until === null || sub.active_until === undefined) {
      return { ok: false, reason: REASONS.LIFETIME_NOT_ELIGIBLE };
    }

    const now = Date.now();
    const currentUntil = Number(sub.active_until);
    if (!Number.isFinite(currentUntil)) {
      throw new Error('Invalid subscription active_until value');
    }

    const newActiveUntil = currentUntil + coupon.extensionDays * DAY_MS;

    const updated = db
      .prepare('UPDATE subscriptions SET active_until = ?, updated_at = ? WHERE telegram_id = ? AND status = \'ACTIVE\'')
      .run(newActiveUntil, now, telegramId);

    if (updated.changes !== 1) {
      throw new Error('Subscription changed while redeeming coupon');
    }

    db.prepare(
      'INSERT INTO redemptions (code, telegram_id, extension_days, redeemed_at) VALUES (?, ?, ?, ?)'
    ).run(code, telegramId, coupon.extensionDays, now);

    return { ok: true, newActiveUntil, coupon };
  });

  return tx();
}

module.exports = { redeemCoupon, REASONS };
