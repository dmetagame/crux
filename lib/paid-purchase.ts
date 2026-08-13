import type { GatewayClient, PayResult } from "@circle-fin/x402-batching/client";
import { parseAtomicAmount } from "./usdc.ts";
import { EXPECTED_PAYMENT_AMOUNT_HEADER } from "./payment-quote.ts";

export interface PayWithinBudgetOptions<T> {
  onSettled?: (result: PayResult<T>, quotedAtomic: bigint) => void | Promise<void>;
}

export class PaymentAmountMismatchError<T = unknown> extends Error {
  readonly quotedAtomic: bigint;
  readonly remainingAtomic: bigint;
  readonly result: PayResult<T>;

  constructor(result: PayResult<T>, quotedAtomic: bigint, remainingAtomic: bigint) {
    super(
      `Payment amount changed between quote and settlement (${quotedAtomic} to ${result.amount} atomic USDC).`,
    );
    this.name = "PaymentAmountMismatchError";
    this.result = result;
    this.quotedAtomic = quotedAtomic;
    this.remainingAtomic = remainingAtomic;
  }
}

export async function payWithinBudget<T>(
  gateway: GatewayClient,
  url: string,
  remainingAtomic: bigint,
  options: PayWithinBudgetOptions<T> = {},
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

  const result = await gateway.pay<T>(url, {
    method: "GET",
    headers: {
      [EXPECTED_PAYMENT_AMOUNT_HEADER]: quotedAtomic.toString(),
    },
  });
  await options.onSettled?.(result, quotedAtomic);
  if (result.amount !== quotedAtomic) {
    throw new PaymentAmountMismatchError(result, quotedAtomic, remainingAtomic);
  }
  return result;
}
