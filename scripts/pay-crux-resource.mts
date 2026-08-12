import { BatchEvmScheme, GatewayClient } from "@circle-fin/x402-batching/client";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseAtomicAmount } from "../lib/usdc.ts";

const ARC_NETWORK = "eip155:5042002";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

const privateKey = process.env.ARC_TESTNET_PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey) throw new Error("ARC_TESTNET_PRIVATE_KEY is required.");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("ARC_TESTNET_PRIVATE_KEY must be a 32-byte hex private key.");
}

const baseUrl = (process.env.CRUX_BASE_URL ?? "https://crux-khaki.vercel.app").replace(/\/$/, "");
const resourcePath = process.env.CRUX_RESOURCE_PATH ?? "/api/premium/quote";
const hardMaxSpendAtomic = BigInt(100_000);
const maxSpendText = process.env.CRUX_MAX_SPEND_USDC?.trim() || "0.001";
const maxAtomic = parseUsdcDecimal(maxSpendText);
if (maxAtomic <= BigInt(0) || maxAtomic > hardMaxSpendAtomic) {
  throw new Error("CRUX_MAX_SPEND_USDC must be greater than 0 and no more than 0.1 USDC.");
}
const base = new URL(`${baseUrl}/`);
const resource = new URL(resourcePath, base);
if (resource.origin !== base.origin) {
  throw new Error("CRUX_RESOURCE_PATH must resolve to the configured Crux origin.");
}
const resourceUrl = resource.toString();
const gateway = new GatewayClient({ chain: "arcTestnet", privateKey });

const challengeResponse = await fetch(resourceUrl, { method: "GET", redirect: "error" });
if (challengeResponse.status !== 402) {
  throw new Error(`Expected a 402 challenge, received HTTP ${challengeResponse.status}.`);
}
const challengeBody = await challengeResponse.json().catch(() => ({}));
const x402 = new x402Client();
x402.register(ARC_NETWORK, new BatchEvmScheme(gateway.account));
const http = new x402HTTPClient(x402);
const paymentRequired = http.getPaymentRequiredResponse(
  (name) => challengeResponse.headers.get(name),
  challengeBody,
);
const gatewayRequirements = paymentRequired.accepts.find((requirements) =>
  requirements.network === ARC_NETWORK &&
  requirements.extra?.name === "GatewayWalletBatched" &&
  requirements.extra?.version === "1"
);
if (!gatewayRequirements) {
  throw new Error("Crux resource does not advertise Arc Gateway batching.");
}
if (
  getAddress(gatewayRequirements.asset) !== getAddress(ARC_USDC) ||
  getAddress(String(gatewayRequirements.extra?.verifyingContract)) !==
    getAddress(ARC_GATEWAY_WALLET)
) {
  throw new Error("Refused an unexpected Arc asset or Gateway verifying contract.");
}

const quotedAtomic = parseAtomicAmount(gatewayRequirements.amount);
if (quotedAtomic > maxAtomic) {
  throw new Error(
    `Refused: resource quotes ${formatAtomic(quotedAtomic)} USDC, above CRUX_MAX_SPEND_USDC=${maxSpendText}.`,
  );
}

const balances = await gateway.getBalances();
if (balances.gateway.available < quotedAtomic) {
  const depositAtomic = quotedAtomic * 2n;
  const nativeGas = await gateway.publicClient.getBalance({ address: gateway.address });
  if (balances.wallet.balance < depositAtomic) {
    throw new Error(
      `Wallet needs at least ${Number(depositAtomic) / 1_000_000} USDC. Fund ${gateway.address} at faucet.circle.com on Arc testnet.`,
    );
  }
  if (nativeGas === 0n) {
    throw new Error(
      `Wallet has no Arc native gas. Fund ${gateway.address} at faucet.circle.com on Arc testnet.`,
    );
  }
  await gateway.deposit(formatAtomic(depositAtomic));
  await waitForGatewayCredit(gateway, quotedAtomic);
}
const paymentPayload = await http.createPaymentPayload({
  ...paymentRequired,
  accepts: [gatewayRequirements],
});
const paymentHeaders = http.encodePaymentSignatureHeader(paymentPayload);
const paidResponse = await fetch(resourceUrl, {
  method: "GET",
  headers: paymentHeaders,
  redirect: "error",
});
if (!paidResponse.ok) {
  const error = await paidResponse.text();
  throw new Error(`Payment failed with HTTP ${paidResponse.status}: ${error.slice(0, 300)}`);
}
const settlement = http.getPaymentSettleResponse((name) => paidResponse.headers.get(name));
if (!settlement.success || !settlement.transaction?.trim()) {
  throw new Error(settlement.errorReason ?? "Payment settled without a public settlement reference.");
}

const payer = privateKeyToAccount(privateKey).address;
const proofUrl = `${baseUrl}/api/payments/by-reference/${encodeURIComponent(settlement.transaction)}`;

console.log(JSON.stringify({
  payer,
  resource: resourceUrl,
  amountUsdc: formatAtomic(quotedAtomic),
  settlementReference: settlement.transaction,
  proofUrl,
  next:
    "Send the payer address and proofUrl to the Crux maintainer so the address can be explicitly attributed as an independent external x402 payer.",
}, null, 2));

function parseUsdcDecimal(value: string) {
  if (value.length > 32 || !/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new Error("CRUX_MAX_SPEND_USDC must be a decimal with at most 6 places.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1_000_000) + BigInt((fraction + "000000").slice(0, 6));
}

function formatAtomic(value: bigint) {
  const whole = value / BigInt(1_000_000);
  const fraction = (value % BigInt(1_000_000))
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function waitForGatewayCredit(gateway: GatewayClient, requiredAtomic: bigint) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const balances = await gateway.getBalances();
    if (balances.gateway.available >= requiredAtomic) return;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("Gateway deposit confirmed on-chain but was not available for payment within 30 seconds.");
}
