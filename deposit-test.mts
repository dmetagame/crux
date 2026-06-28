import { GatewayClient } from "@circle-fin/x402-batching/client";
import { requireHousePrivateKey } from "./lib/wallet-keys.ts";

const buyerKey = requireHousePrivateKey();

const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });

console.log("Balances before deposit:");
const before = await gateway.getBalances();
console.log(`  wallet USDC:      ${before.wallet.balance}`);
console.log(`  gateway available: ${before.gateway.formattedAvailable}`);

console.log("\nDepositing 1 USDC into Circle Gateway on Arc testnet...");
const result = await gateway.deposit("1");
console.log(`Deposit tx hash: ${result.depositTxHash}`);
console.log(`Explorer: https://testnet.arcscan.app/tx/${result.depositTxHash}`);

const after = await gateway.getBalances();
console.log("\nBalances after deposit:");
console.log(`  wallet USDC:      ${after.wallet.balance}`);
console.log(`  gateway available: ${after.gateway.formattedAvailable}`);
