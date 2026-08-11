import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from "viem";
import {
  addressFromPrivateKey,
  requireHousePrivateKey,
  requireSellerPrivateKey,
  type HexAddress,
  type HexPrivateKey,
} from "../lib/wallet-keys.ts";

const RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000" as const;

const client = createPublicClient({ transport: http(RPC) });

const wallets = [
  {
    label: "house",
    privateKey: requireHousePrivateKey(),
    purpose: "buyer wallet for operator/trusted-agent runs",
  },
  {
    label: "seller",
    privateKey: requireSellerPrivateKey(),
    purpose: "seller wallet receiving x402 nanopayments",
  },
].map((wallet) => ({
  ...wallet,
  address: addressFromPrivateKey(wallet.privateKey),
}));

for (const wallet of wallets) {
  const [native, erc20, gateway] = await Promise.all([
    nativeBalance(wallet.address),
    usdcBalance(wallet.address),
    gatewayBalances(wallet.privateKey),
  ]);

  console.log(`${wallet.label.toUpperCase()} (${wallet.purpose})`);
  console.log(`  address:             ${wallet.address}`);
  console.log(`  wallet native gas:   ${native} USDC`);
  console.log(`  wallet ERC-20 USDC:  ${erc20} USDC`);
  console.log(`  Gateway available:   ${gateway.available} USDC`);
  console.log(`  Gateway total:       ${gateway.total} USDC`);
  console.log("");
}

async function nativeBalance(address: HexAddress) {
  const balance = await client.getBalance({ address });
  return trim(formatEther(balance));
}

async function usdcBalance(address: HexAddress) {
  const balance = await client.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
  return trim(formatUnits(balance as bigint, 6));
}

async function gatewayBalances(privateKey: HexPrivateKey) {
  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey });
  const balances = await gateway.getBalances();
  return {
    available: trim(formatAtomicUsdc(balances.gateway.available)),
    total: trim(formatAtomicUsdc(balances.gateway.total)),
  };
}

function formatAtomicUsdc(value: bigint) {
  return formatUnits(value, 6);
}

function trim(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}
