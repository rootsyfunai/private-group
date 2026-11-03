# Telegram USDT private-group access

This service sells 30-day access to a private Telegram group for 10 USDT on BNB
Smart Chain (BEP20). It stores memberships in PostgreSQL and is designed to run
on Railway.

Users scan the Binance QR, send USDT to the configured wallet, and reply with the
transaction hash. The bot verifies the transfer directly on BNB Smart Chain
through public RPC endpoints, then approves their join request. Members are
removed when access expires.

Users can tap **Free preview** for a one-time 3-minute preview. A user can start a
new preview only after 24 hours have passed since their last one. Preview expiry
is stored in PostgreSQL, so restarts do not leave preview members in the group.
Set `PREVIEW_MINUTES` to change the duration.

## Referrals

Users can tap **Refer & earn** or use `/refer` to get a personal invite link:

```text
https://t.me/<bot_username>?start=ref_<user_id>
```

A new user who starts the bot through a referral link immediately receives
`REFERRAL_BONUS_DAYS` free days (default 2) without paying. When that referred
user later pays, the referrer earns `REFERRAL_REWARD_DAYS` free days (default 4).

Each referred user can claim the bonus once, and each payment rewards the
referrer once. Self-referrals are ignored. The referral link is shown in the
`/start` message and via `/refer` or **Refer & earn**.

The admin receives a direct message for each user action: button clicks, text
messages, preview starts, payment attempts, join requests, and removals. Admin
activity is not logged back to the admin.

Users can also tap **Contact admin** to send a message through the bot. The admin
receives it with a **Reply** button; replies are delivered by the bot without
revealing the admin's Telegram account. The admin can also use
`/reply <user_id> <message>`.

## Setup

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather).
2. Add the bot to the private group as an administrator with permission to invite,
   approve join requests, ban, and unban members. Set `PRIVATE_GROUP_ID` to the
   group ID (usually starts with `-100`). Set `ADMIN_USER_ID` to the Telegram user
   ID that should receive purchase and expiry notifications.
3. Create a Railway PostgreSQL service and copy its `DATABASE_URL`.
4. Copy `.env.example` to `.env`, fill in the values, then run:

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
on-chain verification, join approval, and expiry removal all work. Confirm local
legal, tax, consumer-protection, and cryptocurrency compliance requirements.
