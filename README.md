# Telegram USDT private-group access

This service sells 30-day access to a private Telegram group for 10 USDT on BNB
Smart Chain (BEP20). It stores memberships in PostgreSQL and is designed to run
on Railway.

Users scan the Binance QR, send USDT to the configured wallet, and reply with the
transaction hash. The bot verifies the transfer through BscScan, then approves
their join request. Members are removed when access expires.

## Setup

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather).
2. Add the bot to the private group as an administrator with permission to invite,
   approve join requests, ban, and unban members. Set `PRIVATE_GROUP_ID` to the
   group ID (usually starts with `-100`). Set `ADMIN_USER_ID` to the Telegram user
   ID that should receive purchase and expiry notifications.
3. Create a free BscScan API key at <https://bscscan.com/myapikey>.
4. Create a Railway PostgreSQL service and copy its `DATABASE_URL`.
5. Copy `.env.example` to `.env`, fill in the values, then run:

   ```sh
   npm install
   npm run build
   npm start
   ```

   On Railway, set the same variables in the service and use the start command
   `npm start`.

The bot uses long polling, so no public webhook URL is required. Each transaction
hash can only be redeemed once. The QR image is read from `QR_IMAGE_PATH`
(default `qrcode.jpg`), so it must be present in the deployed working directory.

Before accepting real payments, test with a small transfer and confirm the
BscScan verification, join approval, and expiry removal all work. Confirm local
legal, tax, consumer-protection, and cryptocurrency compliance requirements.
