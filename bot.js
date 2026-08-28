'use strict';

const { Telegraf, Markup } = require('telegraf');
const db = require('./db');
const { TIERS, getTier, RECEIVING_WALLET } = require('./pricing');
const { createInvoice } = require('./invoice');
const { redeemCoupon } = require('./coupon');

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isSafeInteger);

const MAX_SUBSCRIBERS = Math.max(1, Number.parseInt(process.env.MAX_SUBSCRIBERS || '100', 10));
const INVOICE_TIMEOUT_MINUTES = Math.max(1, Number.parseInt(process.env.INVOICE_TIMEOUT_MINUTES || '15', 10));

function isAdmin(id) {
  return ADMIN_IDS.includes(Number(id));
}

function activeSubscriberCount() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'ACTIVE'").get();
  return Number(row.n || 0);
}

function getActiveSubscription(telegramId) {
  return db
    .prepare("SELECT * FROM subscriptions WHERE telegram_id = ? AND status = 'ACTIVE' LIMIT 1")
    .get(telegramId);
}

function formatDate(timestamp) {
  if (timestamp === null || timestamp === undefined) return 'never (lifetime)';
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return 'unknown';
  return new Date(value).toISOString().slice(0, 10);
}

function buildBot(activateSubscription) {
  if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required');
  if (typeof createInvoice !== 'function') throw new Error('createInvoice is not available');

  const bot = new Telegraf(process.env.BOT_TOKEN);

  function fullForNewSubscriber(ctx) {
    const current = activeSubscriberCount();
    const alreadySubscribed = Boolean(getActiveSubscription(ctx.from.id));
    return current >= MAX_SUBSCRIBERS && !alreadySubscribed;
  }

  bot.start(async (ctx) => {
    if (fullForNewSubscriber(ctx)) {
      return ctx.reply(
        `Memes Alpha is full at ${MAX_SUBSCRIBERS} members right now. Message an admin to be notified when a spot opens.`
      );
    }

    const buttons = Object.entries(TIERS).map(([key, tier]) =>
      Markup.button.callback(`${tier.label} — $${tier.priceUsd}`, `tier:${key}`)
    );

    return ctx.reply('Choose your Memes Alpha tier:', Markup.inlineKeyboard(buttons, { columns: 1 }));
  });

  bot.action(/^tier:(weekly|monthly|annual|lifetime)$/, async (ctx) => {
    await ctx.answerCbQuery();

    if (fullForNewSubscriber(ctx)) {
      return ctx.editMessageText('Sorry — Memes Alpha filled up while you were choosing. No charge made.');
    }

    const tierKey = ctx.match[1];
    const tier = getTier(tierKey);
    const invoice = createInvoice(ctx.from.id, tierKey);

    return ctx.editMessageText([
      `*${tier.label}*`,
      '',
      'Send exactly:',
      `\`${invoice.exactAmount} USDT\``,
      '(Solana network)',
      '',
      'To:',
      `\`${RECEIVING_WALLET}\``,
      '',
      '⚠️ The amount must match exactly — it is how the payment is identified.',
      '⚠️ Solana network only — USDT sent on another chain will not be detected.',
      `Invoice expires in ${INVOICE_TIMEOUT_MINUTES} minutes.`,
      '',
      'Use /status to check.',
    ].join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('status', async (ctx) => {
    const sub = getActiveSubscription(ctx.from.id);
    if (sub) {
      return ctx.reply(`Tier: ${sub.tier}\nStatus: ${sub.status}\nActive until: ${formatDate(sub.active_until)}`);
    }

    const pending = db
      .prepare("SELECT * FROM invoices WHERE telegram_id = ? AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1")
      .get(ctx.from.id);

    if (pending) return ctx.reply(`Invoice pending: ${pending.exact_amount} USDT. Waiting for payment...`);
    return ctx.reply('No active subscription. Use /start to subscribe.');
  });

  // Coupon codes are private promo inventory. Do not expose the codes or remaining
  // redemptions to arbitrary users. Admins can inspect inventory with /coupons.
  bot.command('coupons', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Admin only.');

    const { COUPONS } = require('./pricing');
    const lines = Object.entries(COUPONS).map(([code, coupon]) => {
      const used = Number(db.prepare('SELECT COUNT(*) AS n FROM redemptions WHERE code = ?').get(code).n || 0);
      const remaining = coupon.maxRedemptions == null
        ? 'unlimited'
        : `${Math.max(0, coupon.maxRedemptions - used)}/${coupon.maxRedemptions} left`;
      return `\`${code}\` — ${coupon.label} — ${remaining}`;
    });

    return ctx.reply(`Coupon inventory:\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.command('redeem', async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const code = parts[1];
    if (!code) return ctx.reply('Usage: /redeem <code>');

    try {
      const result = redeemCoupon(ctx.from.id, code);

      if (result.ok) {
        return ctx.reply(`✅ ${result.coupon.label} applied. Your subscription now runs until ${formatDate(result.newActiveUntil)}.`);
      }

      const messages = {
        NOT_FOUND: "That code doesn't exist.",
        ALREADY_USED: "You've already redeemed this code.",
        SOLD_OUT: 'This code has hit its redemption limit — no more free extensions are available on it.',
        NO_SUBSCRIPTION: 'You need an active subscription before redeeming a code.',
        WRONG_TIER: "This code isn't valid for your current tier.",
        LIFETIME_NOT_ELIGIBLE: "Lifetime subscriptions don't need an extension — this code doesn't apply.",
        COUPON_ALREADY_REDEEMED: "You've already used a coupon. Coupon extensions cannot be stacked.",
      };

      return ctx.reply(messages[result.reason] || 'The coupon could not be redeemed.');
    } catch (error) {
      console.error('Coupon redemption failed:', error);
      return ctx.reply('Could not redeem the coupon right now. Please try again later.');
    }
  });

  // Optional admin-only manual activation hook. The callback must be supplied by the
  // application and should use the same activation/invite flow as confirmed payments.
  bot.command('force_activate', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply('Admin only.');
    if (typeof activateSubscription !== 'function') {
      return ctx.reply('Manual activation is not configured.');
    }

    const parts = ctx.message.text.trim().split(/\s+/);
    const telegramId = Number(parts[1]);
    const tierKey = parts[2];

    if (!Number.isSafeInteger(telegramId) || !TIERS[tierKey]) {
      return ctx.reply('Usage: /force_activate <telegram_id> <weekly|monthly|annual|lifetime>');
    }

    try {
      await activateSubscription({ telegramId, tierKey, source: 'admin_force_activate' });
      return ctx.reply(`Activated ${tierKey} for ${telegramId}.`);
    } catch (error) {
      console.error('Force activation failed:', error);
      return ctx.reply(`Activation failed: ${error.message || 'unknown error'}`);
    }
  });

  bot.catch((error, ctx) => {
    console.error(`Telegram bot error for update ${ctx.update?.update_id || 'unknown'}:`, error);
  });

  return bot;
}

module.exports = { buildBot, isAdmin, activeSubscriberCount, getActiveSubscription };
