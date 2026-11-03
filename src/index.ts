import { Bot, InlineKeyboard, InputFile } from "grammy";
import { createServer } from "node:http";
import { config } from "./config.js";
import { verifyUsdtPayment } from "./bscscan.js";
import {
  activeMembership,
  expiredMemberships,
  initializeDatabase,
  pool,
  recordJoinRequest,
  recordWalletPayment,
  upsertMembership,
} from "./db.js";

const bot = new Bot(config.botToken);
const txHashPattern = /^0x[0-9a-fA-F]{64}$/;
const awaitingAdminMessage = new Set<number>();

bot.command(["start", "buy"], async (context) => {
  await context.reply(
    `Private group access costs ${config.priceUsdt} USDT for ${config.subscriptionDays} days.`,
    {
      reply_markup: new InlineKeyboard()
        .text("Buy access", "buy_access")
        .row()
        .text("Contact admin", "contact_admin"),
    },
  );
});

bot.callbackQuery("contact_admin", async (context) => {
  await context.answerCallbackQuery();
  awaitingAdminMessage.add(context.from!.id);
  await context.reply("Send your message for the admin. Use /cancel to stop.");
});

bot.command("cancel", async (context) => {
  if (awaitingAdminMessage.delete(context.from!.id)) {
    await context.reply("Message cancelled.");
  }
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
      `Send exactly ${config.priceUsdt} USDT on BNB Smart Chain (BEP20) to:\n` +
      `\`${config.walletAddress}\`\n\n` +
      "You can open your Binance app and scan the QR code. Confirm it is set to USDT " +
      "and the BNB Smart Chain (BEP20) network before paying.\n\n" +
      "After sending, reply with the transaction hash (0x...).",
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
    return;
  }
  if (!(await recordWalletPayment(txHash, userId))) {
    await context.reply("This transaction has already been used.");
    return;
  }

  const expiresAt = await upsertMembership(userId, config.subscriptionDays);
  await context.reply(
    `Payment confirmed. Your access expires ${expiresAt.toISOString()}. Request to join the private group now.`,
  );
  await bot.api.sendMessage(
    config.adminUserId,
    `New purchase: user ${userId}, ${config.priceUsdt} USDT, tx ${txHash}, expires ${expiresAt.toISOString()}.`,
  );
});

bot.on("chat_join_request", async (context) => {
  if (String(context.chatJoinRequest.chat.id) !== config.groupId) return;
  const userId = context.chatJoinRequest.from.id;
  if (await activeMembership(userId)) {
    await context.approveChatJoinRequest(userId);
    return;
  }
  await recordJoinRequest(userId);
  await context.api.sendMessage(
    userId,
    `Your join request is pending. Pay ${config.priceUsdt} USDT for ${config.subscriptionDays} days of access, then request again.`,
    { reply_markup: new InlineKeyboard().text("Buy access", "buy_access") },
  );
});

async function removeExpiredMembers(): Promise<void> {
  for (const userId of await expiredMemberships()) {
    await bot.api.banChatMember(config.groupId, userId);
    await bot.api.unbanChatMember(config.groupId, userId, { only_if_banned: true });
    await bot.api.sendMessage(config.adminUserId, `Access expired and member ${userId} was removed.`);
  }
}

async function main(): Promise<void> {
  await initializeDatabase();
  setInterval(() => removeExpiredMembers().catch(console.error), 60_000);
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
