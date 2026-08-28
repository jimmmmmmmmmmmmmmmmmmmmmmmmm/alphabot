# Memes Alpha Telegram Bot

Production-oriented Node.js/Telegraf bot for subscription sales, Solana USDT invoices, subscription status, coupon extensions, and restricted admin actions.

## Files

- `bot.js` — Telegram commands and callbacks.
- `pricing.js` — tiers, Solana USDT configuration, and promo codes.
- `coupon.js` — transactional coupon redemption logic.
- `db.js` — **required from your existing application**; it must export a better-sqlite3-style `db` instance with `prepare()` and `transaction()`.
- `invoice.js` — **required from your existing application**; it must export `createInvoice(telegramId, tierKey)`.
- `server.js` — **required/optional application entrypoint**; wire `buildBot()` to your payment/webhook activation flow.

## Install

```bash
npm install
cp .env.example .env
npm run check
```

Set `BOT_TOKEN`, `ADMIN_TELEGRAM_IDS`, `USDT_SOL_MINT`, and `RECEIVING_WALLET` before starting.

## Bot commands

- `/start` — show subscription tiers.
- `/status` — show current subscription or pending invoice.
- `/redeem CODE` — redeem one eligible promo code.
- `/coupons` — admin-only coupon inventory.
- `/force_activate TELEGRAM_ID TIER` — admin-only manual activation hook.

## Important deployment notes

1. BotFather creates the Telegram bot and supplies the token; it does not run this Node.js application.
2. Run the application on a VPS/container/Node host.
3. Keep `.env` out of Git.
4. Keep the SQLite database out of Git.
5. Payment verification must be performed server-side from the Solana transaction/mint/amount/recipient, not from Telegram user input.
6. The invoice amount must be unique enough for the payment-verification layer to identify the intended invoice safely.
7. Coupon redemption is transactional, but a production deployment should also have a database uniqueness constraint on `(code, telegram_id)`.
8. The subscriber-cap check in Telegram UI is only a UX guard. Enforce the actual capacity atomically in the subscription activation transaction.
