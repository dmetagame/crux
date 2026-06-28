import { GatewayClient } from "@circle-fin/x402-batching/client";
import { requireHousePrivateKey } from "./lib/wallet-keys.ts";

const buyerKey = requireHousePrivateKey();
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const TOPIC = encodeURIComponent("Northwind Logistics");

const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });

const before = await gateway.getBalances();
console.log(`Gateway available: ${before.gateway.formattedAvailable} USDC`);
if (before.gateway.available < 200_000n) {
  console.log("Low balance — depositing 1 USDC...");
  await gateway.deposit("1");
}

// financials + premium-analysis once; insider-interview x5 to exercise the
// reliability simulation; rumor-wire once (the misleading cheap source).
const buys = [
  "financials",
  "premium-analysis",
  "insider-interview",
  "insider-interview",
  "insider-interview",
  "insider-interview",
  "insider-interview",
  "rumor-wire",
];

let delivered = 0;
let degraded = 0;

for (const id of buys) {
  const url = `${BASE}/api/research/${id}?topic=${TOPIC}`;
  try {
    const res = await gateway.pay(url, { method: "GET" });
    const d = res.data as { delivered: boolean; content: string };
    if (d.delivered) delivered++;
    else degraded++;
    const tag = d.delivered ? "OK " : "DEGRADED";
    console.log(`[${tag}] ${id} (${res.formattedAmount} USDC) :: ${d.content.slice(0, 90)}...`);
  } catch (err) {
    console.error(`[FAIL] ${id}: ${(err as Error).message}`);
  }
}

console.log(`\nDelivered: ${delivered}  Degraded: ${degraded} (insider-interview should sometimes degrade)`);
