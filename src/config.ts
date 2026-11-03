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
  priceStars: Number(process.env.SUBSCRIPTION_PRICE_STARS ?? "500"),
  subscriptionDays: Number(process.env.SUBSCRIPTION_DAYS ?? "30"),
  port: Number(process.env.PORT ?? "3000"),
};

if (!Number.isInteger(config.subscriptionDays) || config.subscriptionDays <= 0) {
  throw new Error("SUBSCRIPTION_DAYS must be a positive integer");
}

if (!Number.isInteger(config.priceStars) || config.priceStars <= 0) {
  throw new Error("SUBSCRIPTION_PRICE_STARS must be a positive integer");
}
