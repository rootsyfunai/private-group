import { config } from "./config.js";

const endpoint = "https://api.bscscan.com/v2/api";
const usdtContract = "0x55d398326f99059ff775485246999027b3197955";

type TokenTransfer = {
  hash: string;
  to: string;
  value: string;
  tokenDecimal: string;
  contractAddress: string;
};

type ApiResponse<T> = { status: string; message: string; result: T };

async function get<T>(params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ chainid: "56", apikey: config.bscScanApiKey, ...params });
  const response = await fetch(`${endpoint}?${query}`);
  if (!response.ok) throw new Error(`BscScan returned HTTP ${response.status}`);
  const body = (await response.json()) as ApiResponse<T>;
  if (body.status !== "1") throw new Error(`BscScan error: ${body.message}`);
  return body.result;
}

export async function verifyUsdtPayment(txHash: string, expectedAmount: string): Promise<boolean> {
  const receipt = await get<{ status: string }>({
    module: "transaction",
    action: "gettxreceiptstatus",
    txhash: txHash,
  });
  if (receipt.status !== "1") return false;

  const transfers = await get<TokenTransfer[]>({
    module: "account",
    action: "tokentx",
    contractaddress: usdtContract,
    address: config.walletAddress,
    page: "1",
    offset: "100",
    sort: "desc",
  });
  const transfer = transfers.find((item) => item.hash.toLowerCase() === txHash.toLowerCase());
  if (!transfer) return false;
  if (transfer.to.toLowerCase() !== config.walletAddress.toLowerCase()) return false;
  if (transfer.contractAddress.toLowerCase() !== usdtContract) return false;

  const received = Number(transfer.value) / 10 ** Number(transfer.tokenDecimal);
  return received >= Number(expectedAmount);
}
