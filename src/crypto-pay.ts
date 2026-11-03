import { config } from "./config.js";

const endpoint = "https://pay.crypt.bot/api";

type CryptoInvoice = { invoice_id: number; status: string; pay_url: string };

async function call<T>(method: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(`${endpoint}/${method}`, {
    method: "POST",
    headers: {
      "Crypto-Pay-API-Token": config.cryptoPayToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(`CryptoBot API returned HTTP ${response.status}`);
  const body = (await response.json()) as { ok: boolean; result: T; error?: { name: string } };
  if (!body.ok) throw new Error(`CryptoBot API error: ${body.error?.name ?? "unknown error"}`);
  return body.result;
}

export function createInvoice(userId: number): Promise<CryptoInvoice> {
  return call<CryptoInvoice>("createInvoice", {
    currency_type: "crypto",
    asset: "USDT",
    amount: config.priceUsdt,
    description: `Private group access for ${config.subscriptionDays} days`,
    payload: String(userId),
    expires_in: "3600",
  });
}

export async function paidInvoices(): Promise<CryptoInvoice[]> {
  const result = await call<{ items: CryptoInvoice[] }>("getInvoices", {
    status: "paid",
    count: "100",
  });
  return result.items;
}
