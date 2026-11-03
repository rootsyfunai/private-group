import { Bot, InlineKeyboard } from "grammy";
import { createServer } from "node:http";
import { config } from "./config.js";
import { createInvoice, paidInvoices } from "./crypto-pay.js";
import {
  activeMembership,
  expiredMemberships,
  initializeDatabase,
  markPaid,
  pool,
  recordInvoice,
  recordJoinRequest,
  upsertMembership,
} from "./db.js";

const bot = new Bot(config.botToken);

bot.command(["start", "buy"], async (context) => {
  await context.reply(
    `Private group access costs ${config.priceUsdt} USDT for ${config.subscriptionDays} days.`,
    { reply_markup: new InlineKeyboard().text("Buy access", "buy_access") },
  );
});

bot.callbackQuery("buy_access", async (context) => {
  await context.answerCallbackQuery();
  const invoice = await createInvoice(context.from.id);
  await recordInvoice(String(invoice.invoice_id), context.from.id);
  await context.reply("Your invoice is ready. After payment, request to join the private group.", {
    reply_markup: new InlineKeyboard().url("Pay with CryptoBot", invoice.pay_url),
  });
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

async function processPaidInvoices(): Promise<void> {
  for (const invoice of await paidInvoices()) {
    const userId = await markPaid(String(invoice.invoice_id));
    if (!userId) continue;
    const expiresAt = await upsertMembership(userId, config.subscriptionDays);
    await bot.api.sendMessage(
      userId,
      `Payment confirmed. Your access expires ${expiresAt.toISOString()}. Request to join the private group now.`,
    );
    await bot.api.sendMessage(
      config.adminUserId,
      `New purchase: user ${userId}, ${config.priceUsdt} USDT, expires ${expiresAt.toISOString()}.`,
    );
  }
}

async function removeExpiredMembers(): Promise<void> {
  for (const userId of await expiredMemberships()) {
    await bot.api.banChatMember(config.groupId, userId);
    await bot.api.unbanChatMember(config.groupId, userId, { only_if_banned: true });
    await bot.api.sendMessage(config.adminUserId, `Access expired and member ${userId} was removed.`);
  }
}

async function main(): Promise<void> {
  await initializeDatabase();
  setInterval(() => processPaidInvoices().catch(console.error), 30_000);
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
