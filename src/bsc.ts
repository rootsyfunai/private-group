import { config } from "./config.js";

const rpcEndpoints = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
];

const usdtContract = "0x55d398326f99059ff775485246999027b3197955";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type RpcResponse<T> = { result?: T; error?: { message: string } };

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastError: unknown;
  for (const endpoint of rpcEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as RpcResponse<T>;
      if (body.error) throw new Error(body.error.message);
      if (body.result === undefined) throw new Error("Empty RPC result");
      return body.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`All BSC RPC endpoints failed: ${String(lastError)}`);
}

function addressTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

export async function verifyUsdtPayment(txHash: string, expectedAmount: string): Promise<boolean> {
  const receipt = await rpc<{ status: string; logs: { address: string; topics: string[]; data: string }[] }>(
    "eth_getTransactionReceipt",
    [txHash],
  );
  if (!receipt || receipt.status !== "0x1") return false;

  const expected = BigInt(Math.round(Number(expectedAmount) * 1e18));
  const recipient = addressTopic(config.walletAddress);

  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== usdtContract) return false;
    if (log.topics[0]?.toLowerCase() !== transferTopic) return false;
    if (log.topics[2]?.toLowerCase() !== recipient) return false;
    return BigInt(log.data) >= expected;
  });
}
