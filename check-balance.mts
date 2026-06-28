import { createPublicClient, http, erc20Abi, formatUnits, formatEther } from "viem";
import { getHouseAddress } from "./lib/wallet-keys.ts";

const RPC = "https://rpc.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000" as const;
const buyer = getHouseAddress();

const client = createPublicClient({ transport: http(RPC) });

const native = await client.getBalance({ address: buyer });
const erc20 = await client.readContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [buyer],
});

console.log(`Buyer: ${buyer}`);
console.log(`Native (gas, 18dp): ${formatEther(native)} USDC`);
console.log(`ERC-20 USDC (6dp):  ${formatUnits(erc20 as bigint, 6)} USDC`);
