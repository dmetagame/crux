/**
 * External-counterparty proof: the agent's payment layer is not limited to our
 * own Arc marketplace. Here it discovers REAL third-party x402 services via
 * Coinbase's x402 Bazaar and pays one of them on Base Sepolia with real (testnet)
 * USDC — a genuine external counterparty, the one thing a pure-Arc entry can't show.
 *
 * Run:  npm run external-demo
 * Env:  BUYER_PRIVATE_KEY (.env.local). The buyer must hold Base Sepolia USDC
 *       (free from https://faucet.circle.com — select Base Sepolia).
 */
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const buyerKey = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
if (!buyerKey) throw new Error("Missing BUYER_PRIVATE_KEY");

const BAZAAR = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=200";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const TARGET = process.env.X402_URL ?? "https://sandbox.node4all.com/v1/x402-test";

const account = privateKeyToAccount(buyerKey);

// 1. Real Bazaar discovery — list external Base Sepolia x402 services.
type Accept = { network: string; amount: string };
type Resource = { resource?: string; url?: string; description?: string; accepts?: Accept[] };
const disc = (await fetch(BAZAAR).then((r) => r.json())) as { items?: Resource[]; resources?: Resource[] };
const items = disc.items ?? disc.resources ?? [];
const sepolia = items.filter((it) => (it.accepts ?? []).some((a) => a.network === "eip155:84532"));
console.log(`Discovered ${sepolia.length} external Base Sepolia x402 services via Coinbase Bazaar:`);
for (const it of sepolia) {
  const a = (it.accepts ?? []).find((x) => x.network === "eip155:84532")!;
  console.log(`  - ${it.resource ?? it.url}  (${Number(a.amount) / 1e6} USDC)  ${(it.description ?? "").slice(0, 64)}`);
}

// 2. Check the buyer's Base Sepolia USDC balance.
const pub = createPublicClient({ chain: baseSepolia, transport: http() });
const bal = (await pub.readContract({
  address: BASE_SEPOLIA_USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [account.address],
})) as bigint;
console.log(`\nBuyer ${account.address}\nBase Sepolia USDC balance: ${formatUnits(bal, 6)}`);
if (bal === 0n) {
  console.log("\n⚠ Buyer holds 0 Base Sepolia USDC. Fund it at https://faucet.circle.com (Base Sepolia), then re-run.");
  process.exit(1);
}

// 3. Pay the real external service via the x402 v2 exact scheme (gasless EIP-3009).
//    Node4All returns v2 requirements in the `payment-required` header (empty body),
//    so we use the @x402/core v2 client (the v1 x402-fetch reads the body and fails).
const signer = toClientEvmSigner(account, pub);
const client = new x402Client();
client.register("eip155:84532", new ExactEvmScheme(signer));
const httpc = new x402HTTPClient(client);

console.log(`\nPaying external service: ${TARGET}`);
const res1 = await fetch(TARGET, { method: "GET" });
const body1 = await res1.json().catch(() => ({}));
const required = httpc.getPaymentRequiredResponse((n) => res1.headers.get(n), body1);
const payload = await httpc.createPaymentPayload(required);
const payHeaders = httpc.encodePaymentSignatureHeader(payload);

const res2 = await fetch(TARGET, { method: "GET", headers: payHeaders });
if (!res2.ok) {
  console.error(`Payment retry failed: HTTP ${res2.status} — ${(await res2.text()).slice(0, 200)}`);
  process.exit(1);
}
const data = await res2.json();
console.log("Response:", JSON.stringify(data).slice(0, 400));

const settle = httpc.getPaymentSettleResponse((n) => res2.headers.get(n));
console.log("\nSettlement:", JSON.stringify(settle));
const tx = (settle as { transaction?: string })?.transaction;
if (tx) console.log(`Explorer: https://sepolia.basescan.org/tx/${tx}`);
console.log("\n✅ Paid a REAL external x402 service on Base — a genuine external counterparty, not self-dealing.");
