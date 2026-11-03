import { Bot, InlineKeyboard, InputFile, Keyboard } from "grammy";
import { createServer } from "node:http";
import { config } from "./config.js";
import { verifyUsdtPayment } from "./bsc.js";
import {
  activeMembership,
  claimReferralBonus,
  claimReferralReward,
  expiredMemberships,
  expiredPreviews,
  initializeDatabase,
  pool,
  recordJoinRequest,
  recordReferral,
  recordWalletPayment,
  referralCount,
  startPreview,
  upsertMembership,
} from "./db.js";

const bot = new Bot(config.botToken);
const txHashPattern = /^0x[0-9a-fA-F]{64}$/;
const awaitingAdminMessage = new Set<number>();
const awaitingVideo = new Set<number>();

const mainKeyboard = new Keyboard()
  .text("Buy access")
  .text("Free preview")
  .row()
  .text("Refer & get free days")
  .row()
  .text("Send videos")
  .text("Contact admin")
  .resized()
  .persistent();

function userLabel(context: { from?: { id: number; username?: string; first_name?: string } }): string {
  const user = context.from;
  if (!user) return "unknown user";
  return `${user.id} (@${user.username ?? "no username"}, ${user.first_name ?? "no name"})`;
}

async function notifyAdmin(message: string): Promise<void> {
  try {
    await bot.api.sendMessage(config.adminUserId, message);
  } catch (error) {
    console.error("Admin notification failed:", error);
  }
}

bot.use(async (context, next) => {
  if (context.from && String(context.from.id) !== config.adminUserId) {
    const action = context.callbackQuery?.data
      ? `clicked ${context.callbackQuery.data}`
      : context.message?.text
        ? `sent: ${context.message.text.slice(0, 200)}`
        : context.chatJoinRequest
          ? "requested to join the group"
          : null;
    if (action) await notifyAdmin(`[Activity] ${userLabel(context)} ${action}`);
  }
  await next();
});

bot.command("start", async (context) => {
  const payload = context.match.trim();
  const userId = context.from!.id;
  if (payload.startsWith("ref_")) {
    const referrerId = Number(payload.slice(4));
    if (Number.isInteger(referrerId) && (await recordReferral(userId, referrerId))) {
      await notifyAdmin(`[Referral] ${userLabel(context)} was referred by ${referrerId}.`);
      if (await claimReferralBonus(userId)) {
        const expiresAt = await upsertMembership(userId, config.referralBonusDays);
        await context.reply(
          `Welcome! You received ${config.referralBonusDays} free days of access. ` +
            `Your access expires ${expiresAt.toISOString()}. Request to join the private group now.`,
        );
        await notifyAdmin(
          `[Referral] User ${userId} received ${config.referralBonusDays} free days from referrer ${referrerId}.`,
        );
      }
    }
  }
  const botInfo = await bot.api.getMe();
  const referralLink = `https://t.me/${botInfo.username}?start=ref_${userId}`;
  await context.reply(
    `Private group access costs ${config.priceUsdt} USDT for ${config.subscriptionDays} days.\n\n` +
      `Share your referral link and earn ${config.referralRewardDays} free days when your friend pays:\n${referralLink}`,
    {
      reply_markup: new InlineKeyboard()
        .text("Buy access", "buy_access")
        .row()
        .text("Free preview", "preview")
        .text("Refer & get free days", "refer")
        .row()
        .text("Send videos", "send_videos")
        .text("Contact admin", "contact_admin"),
    },
  );
  await context.reply("Choose an option below.", { reply_markup: mainKeyboard });
});

bot.callbackQuery("send_videos", async (context) => {
  await context.answerCallbackQuery();
  awaitingVideo.add(context.from!.id);
  await context.reply(
    "Send the video you want to share. You can add a caption with any notes. Use /cancel to stop.",
  );
});

bot.on("message:video", async (context) => {
  const userId = context.from.id;
  if (!awaitingVideo.delete(userId)) return;
  await bot.api.copyMessage(
    config.adminUserId,
    context.chat.id,
    context.message.message_id,
    {
      caption: `Video from ${userLabel(context)}${context.message.caption ? `:\n\n${context.message.caption}` : ""}`,
    },
  );
  await context.reply("Your video was sent to the admin.");
});

bot.callbackQuery("refer", async (context) => {
  await context.answerCallbackQuery();
  const userId = context.from!.id;
  const botInfo = await bot.api.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${userId}`;
  const count = await referralCount(userId);
  await context.reply(
    `Share this link and earn ${config.referralRewardDays} free days when your friend pays.\n\n` +
      `Your link:\n${link}\n\n` +
      `Successful referrals: ${count}`,
  );
});

bot.command("refer", async (context) => {
  const userId = context.from!.id;
  const botInfo = await bot.api.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${userId}`;
  const count = await referralCount(userId);
  await context.reply(
    `Share this link and earn ${config.referralRewardDays} free days when your friend pays.\n\n` +
      `Your link:\n${link}\n\n` +
      `Successful referrals: ${count}`,
  );
});

bot.command("buy", async (context) => {
  await context.reply(
    `Private group access costs ${config.priceUsdt} USDT for ${config.subscriptionDays} days.`,
    {
      reply_markup: new InlineKeyboard()
        .text("Buy access", "buy_access")
        .row()
        .text("Free preview", "preview")
        .text("Refer & get free days", "refer")
        .row()
        .text("Send videos", "send_videos")
        .text("Contact admin", "contact_admin"),
    },
  );
});

bot.hears("Buy access", async (context) => {
  await context.reply("Tap the button below to get the payment details.", {
    reply_markup: new InlineKeyboard().text("Buy access", "buy_access"),
  });
});

bot.hears("Free preview", async (context) => {
  await context.reply("Tap the button below to start your preview.", {
    reply_markup: new InlineKeyboard().text("Free preview", "preview"),
  });
});

bot.hears("Refer & get free days", async (context) => {
  const userId = context.from!.id;
  const botInfo = await bot.api.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${userId}`;
  const count = await referralCount(userId);
  await context.reply(
    `Share this link and earn ${config.referralRewardDays} free days when your friend pays.\n\n` +
      `Your link:\n${link}\n\n` +
      `Successful referrals: ${count}`,
  );
});

bot.hears("Send videos", async (context) => {
  awaitingVideo.add(context.from!.id);
  await context.reply(
    "Send the video you want to share. You can add a caption with any notes. Use /cancel to stop.",
  );
});

bot.hears("Contact admin", async (context) => {
  awaitingAdminMessage.add(context.from!.id);
  await context.reply("Send your message for the admin. Use /cancel to stop.");
});

bot.callbackQuery("preview", async (context) => {
  await context.answerCallbackQuery();
  const userId = context.from!.id;
  if (await activeMembership(userId)) {
    await context.reply("You already have active access.");
    return;
  }
  if (!(await startPreview(userId, config.previewMinutes))) {
    await context.reply("You can only use the free preview once every 24 hours.");
    return;
  }
  const invite = await bot.api.createChatInviteLink(config.groupId, {
    member_limit: 1,
    expire_date: Math.floor(Date.now() / 1000) + 600,
  });
  await context.reply(
    `Your preview link gives access for ${config.previewMinutes} minutes only. ` +
      "You will be removed automatically when it ends.",
    { reply_markup: new InlineKeyboard().url("Join preview", invite.invite_link) },
  );
  await notifyAdmin(`[Preview] ${userLabel(context)} started a ${config.previewMinutes}-minute preview.`);
});

bot.callbackQuery("contact_admin", async (context) => {
  await context.answerCallbackQuery();
  awaitingAdminMessage.add(context.from!.id);
  await context.reply("Send your message for the admin. Use /cancel to stop.");
});

bot.command("cancel", async (context) => {
  const userId = context.from!.id;
  const cancelled = awaitingAdminMessage.delete(userId) || awaitingVideo.delete(userId);
  if (cancelled) await context.reply("Cancelled.");
});

bot.command("reply", async (context) => {
  if (String(context.from!.id) !== config.adminUserId) return;
  const match = context.match.match(/^(\d+)\s+([\s\S]+)$/);
  if (!match) {
    await context.reply("Usage: /reply <user_id> <message>");
    return;
  }
  await bot.api.sendMessage(match[1], `Admin reply:\n\n${match[2]}`);
  await context.reply("Reply sent.");
});

bot.callbackQuery(/^reply_(\d+)$/, async (context) => {
  if (String(context.from.id) !== config.adminUserId) {
    await context.answerCallbackQuery({ text: "Not allowed." });
    return;
  }
  const userId = Number(context.match[1]);
  awaitingAdminMessage.add(userId);
  await context.answerCallbackQuery();
  await context.reply(`Send your reply to user ${userId}. Use /cancel to stop.`);
});

bot.callbackQuery("buy_access", async (context) => {
  await context.answerCallbackQuery();
  await context.replyWithPhoto(new InputFile(config.qrImagePath), {
    caption:
      `Send exactly ${config.priceUsdt} USDT to:\n` +
      `\`${config.walletAddress}\`\n\n` +
      "You can open your Binance app and scan the QR code. Confirm it is set to USDT " +
      "before paying.\n\n" +
      "After sending, reply with the transaction hash, for example:\n" +
      "`0x4f3a1c2b9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a`",
    parse_mode: "Markdown",
  });
});

bot.on("message:text", async (context) => {
  const text = context.message.text.trim();
  const userId = context.from.id;

  if (awaitingAdminMessage.delete(userId)) {
    if (String(userId) === config.adminUserId) {
      await bot.api.sendMessage(userId, `Admin reply:\n\n${text}`);
      await context.reply("Reply sent.");
    } else {
      await bot.api.sendMessage(
        config.adminUserId,
        `Message from user ${userId} (@${context.from.username ?? "no username"}):\n\n${text}`,
        { reply_markup: new InlineKeyboard().text("Reply", `reply_${userId}`) },
      );
      await context.reply("Your message was sent to the admin.");
    }
    return;
  }

  if (!txHashPattern.test(text)) return;
  const txHash = text;

  await context.reply("Checking the transaction on BNB Smart Chain...");
  let paid: boolean;
  try {
    paid = await verifyUsdtPayment(txHash, config.priceUsdt);
  } catch (error) {
    console.error("Payment verification failed:", error);
    await context.reply("Could not verify the transaction right now. Please try again shortly.");
    return;
  }
  if (!paid) {
    await context.reply(
      `No matching USDT transfer of at least ${config.priceUsdt} to the payment address was found. ` +
        "Check the transaction hash and network (BEP20).",
    );
    await notifyAdmin(`[Payment] ${userLabel(context)} submitted an unverified tx ${txHash}.`);
    return;
  }
  if (!(await recordWalletPayment(txHash, userId))) {
    await context.reply("This transaction has already been used.");
    await notifyAdmin(`[Payment] ${userLabel(context)} tried to reuse tx ${txHash}.`);
    return;
  }

  const expiresAt = await upsertMembership(userId, config.subscriptionDays);
  await context.reply(
    `Payment confirmed. Your access expires ${expiresAt.toISOString()}. Request to join the private group now.`,
  );
  await bot.api.sendMessage(
    userId,
    `Purchase successful: ${config.priceUsdt} USDT for ${config.subscriptionDays} days.\n` +
      `Access expires ${expiresAt.toISOString()}.\n` +
      `Transaction: ${txHash}`,
  );
  await notifyAdmin(
    `New purchase: user ${userId}, ${config.priceUsdt} USDT, tx ${txHash}, expires ${expiresAt.toISOString()}.`,
  );

  const referrerId = await claimReferralReward(userId);
  if (!referrerId) return;
  const referrerExpiry = await upsertMembership(referrerId, config.referralRewardDays);
  await bot.api.sendMessage(
    referrerId,
    `You earned ${config.referralRewardDays} free days because your referral paid. ` +
      `Your access now expires ${referrerExpiry.toISOString()}.`,
  );
  await notifyAdmin(
    `[Referral] User ${referrerId} earned ${config.referralRewardDays} days from user ${userId}'s payment.`,
  );
});

bot.on("chat_join_request", async (context) => {
  if (String(context.chatJoinRequest.chat.id) !== config.groupId) return;
  const userId = context.chatJoinRequest.from.id;
  if (await activeMembership(userId)) {
    await context.approveChatJoinRequest(userId);
    await notifyAdmin(`[Join] ${userLabel(context)} was approved automatically.`);
    return;
  }
  await recordJoinRequest(userId);
  await notifyAdmin(`[Join] ${userLabel(context)} requested to join without active access.`);
  await context.api.sendMessage(
    userId,
    `Your join request is pending. Pay ${config.priceUsdt} USDT for ${config.subscriptionDays} days of access, then request again.`,
    { reply_markup: new InlineKeyboard().text("Buy access", "buy_access") },
  );
});

async function removeMember(userId: number): Promise<boolean> {
  try {
    const member = await bot.api.getChatMember(config.groupId, userId);
    if (member.status === "creator" || member.status === "administrator") {
      await notifyAdmin(`[Skip] User ${userId} is a group ${member.status}; not removed.`);
      return false;
    }
    await bot.api.banChatMember(config.groupId, userId);
    await bot.api.unbanChatMember(config.groupId, userId, { only_if_banned: true });
    return true;
  } catch (error) {
    console.error(`Failed to remove user ${userId}:`, error);
    await notifyAdmin(`[Error] Could not remove user ${userId}: ${String(error)}`);
    return false;
  }
}

async function removeExpiredMembers(): Promise<void> {
  for (const userId of await expiredMemberships()) {
    if (await removeMember(userId)) {
      await notifyAdmin(`Access expired and member ${userId} was removed.`);
    }
  }
}

async function removeExpiredPreviews(): Promise<void> {
  for (const userId of await expiredPreviews()) {
    if (!(await removeMember(userId))) continue;
    await bot.api.sendMessage(
      userId,
      `Your preview has ended. Buy access for ${config.priceUsdt} USDT to rejoin.`,
      { reply_markup: new InlineKeyboard().text("Buy access", "buy_access") },
    );
    await notifyAdmin(`[Preview] User ${userId} was removed after the preview ended.`);
  }
}

async function main(): Promise<void> {
  await initializeDatabase();
  await bot.api.setMyCommands([
    { command: "start", description: "Show access options" },
    { command: "buy", description: "Buy 30-day access" },
    { command: "refer", description: "Get your referral link" },
    { command: "cancel", description: "Cancel the current action" },
  ]);
  setInterval(() => removeExpiredMembers().catch(console.error), 60_000);
  setInterval(() => removeExpiredPreviews().catch(console.error), 30_000);
  await bot.start();
}

const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("ok");
});
server.listen(config.port);

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
