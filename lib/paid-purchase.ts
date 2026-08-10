import type { GatewayClient } from "@circle-fin/x402-batching/client";
import { parseAtomicAmount } from "./usdc.ts";

export async function payWithinBudget<T>(
  gateway: GatewayClient,
  url: string,
  remainingAtomic: bigint,
) {
  const support = await gateway.supports(url);
  if (!support.supported || !support.requirements) {
    throw new Error(support.error ?? "Source does not support Circle Gateway batching.");
  }

  const quotedAtomic = parseAtomicAmount(support.requirements.amount);
  if (quotedAtomic > remainingAtomic) {
    throw new Error(
      `Refused: x402 challenge requires ${quotedAtomic} atomic USDC but only ${remainingAtomic} remains.`,
    );
  }

  const result = await gateway.pay<T>(url, { method: "GET" });
  if (result.amount !== quotedAtomic) {
    throw new Error(
      `Payment amount changed between quote and settlement (${quotedAtomic} to ${result.amount} atomic USDC).`,
    );
  }
  return result;
}
