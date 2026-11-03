# Telegram CryptoBot private-group access

This service sells 30-day access to a private Telegram group for 10 USDT via
[@CryptoBot](https://t.me/CryptoBot)'s Crypto Pay API or 500 Telegram Stars. It
stores invoices and memberships in PostgreSQL and is designed to run on Railway.

Users pay through the bot, then request to join the group. The bot approves
requests from active members and removes members when access expires.

## Setup

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather).
2. Create a Crypto Pay app with [@CryptoBot](https://t.me/CryptoBot) and copy its API token.
3. Add the bot to the private group as an administrator with permission to invite,
   approve join requests, ban, and unban members. Set `PRIVATE_GROUP_ID` to the
   group ID (usually starts with `-100`). Set `ADMIN_USER_ID` to the Telegram user
   ID that should receive purchase and expiry notifications.
4. Create a Railway PostgreSQL service and copy its `DATABASE_URL`.
5. Copy `.env.example` to `.env`, fill in the values, then run:

   ```sh
   npm install
   npm run build
   npm start
   ```

   On Railway, set the same variables in the service and use the start command
   `npm start`.

The bot uses long polling, so no public webhook URL is required. Paid invoices
are processed idempotently; repeated polling cannot grant duplicate access.
Stars payments are verified through Telegram's `pre_checkout_query` and
`successful_payment` updates, and each charge ID is recorded once.

Set `SUBSCRIPTION_PRICE_STARS` to change the Stars price. Stars are only for
digital goods and services, which matches group access.

Before accepting real payments, test with a separate bot, group, and CryptoBot
test environment where available. Confirm local legal, tax, consumer-protection,
and cryptocurrency compliance requirements.
