'use strict';

// Subscription tiers.
// durationDays: null = lifetime (no expiry).
const TIERS = Object.freeze({
  weekly: Object.freeze({ label: 'Vibe Trader', priceUsd: 29, durationDays: 7 }),
  monthly: Object.freeze({ label: 'Wealth Builder', priceUsd: 49, durationDays: 30 }),
  annual: Object.freeze({ label: 'Annual Pro', priceUsd: 149, durationDays: 365 }),
  lifetime: Object.freeze({ label: 'Lifetime Legend', priceUsd: 199, durationDays: null }),
});

// USDT on Solana only.
const USDT = Object.freeze({
  mint: process.env.USDT_SOL_MINT || '',
  decimals: 6,
});

const RECEIVING_WALLET = process.env.RECEIVING_WALLET || '';
const TIER_ORDER = Object.freeze(['weekly', 'monthly', 'annual', 'lifetime']);

// Promo codes extend an existing non-lifetime subscription.
// A subscriber may redeem at most one coupon in total; see coupon.js.
const COUPONS = Object.freeze({
  EX60D: Object.freeze({ label: '+60 Days Free', extensionDays: 60, eligibleTiers: Object.freeze(['annual']), maxRedemptions: 25 }),
  EX30D: Object.freeze({ label: '+30 Days Free', extensionDays: 30, eligibleTiers: Object.freeze(['annual']), maxRedemptions: 25 }),
  EX15D: Object.freeze({ label: '+15 Days Free', extensionDays: 15, eligibleTiers: Object.freeze(['monthly', 'annual']), maxRedemptions: 25 }),
  EX7D: Object.freeze({ label: '+7 Days Free', extensionDays: 7, eligibleTiers: Object.freeze(['monthly', 'annual']), maxRedemptions: 25 }),
});

function getTier(tierKey) {
  const tier = TIERS[tierKey];
  if (!tier) throw new Error(`Unknown tier: ${tierKey}`);
  return tier;
}

function getCoupon(code) {
  if (typeof code !== 'string' || !code.trim()) return null;
  return COUPONS[code.trim().toUpperCase()] || null;
}

module.exports = { TIERS, USDT, RECEIVING_WALLET, TIER_ORDER, COUPONS, getTier, getCoupon };
