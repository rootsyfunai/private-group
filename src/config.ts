import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  cryptoPayToken: required("CRYPTO_PAY_API_TOKEN"),
  databaseUrl: required("DATABASE_URL"),
  groupId: required("PRIVATE_GROUP_ID"),
  adminUserId: required("ADMIN_USER_ID"),
  priceUsdt: process.env.SUBSCRIPTION_PRICE_USDT ?? "10",
  subscriptionDays: Number(process.env.SUBSCRIPTION_DAYS ?? "30"),
  port: Number(process.env.PORT ?? "3000"),
  walletAddress: required("USDT_WALLET_ADDRESS"),
  qrImagePath: process.env.QR_IMAGE_PATH ?? "qrcode.jpg",
};

if (!Number.isInteger(config.subscriptionDays) || config.subscriptionDays <= 0) {
  throw new Error("SUBSCRIPTION_DAYS must be a positive integer");
}

if (!/^0x[0-9a-fA-F]{40}$/.test(config.walletAddress)) {
  throw new Error("USDT_WALLET_ADDRESS must be a BEP20 wallet address");
}
