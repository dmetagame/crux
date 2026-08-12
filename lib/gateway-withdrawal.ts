const MICRO_USDC = BigInt(1_000_000);
const MIN_FEE_BUFFER_ATOMIC = BigInt(10_000);

export function parseWithdrawalUsdc(value: string) {
  if (value.length > 32 || !/^\d+(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * MICRO_USDC + BigInt((fraction + "000000").slice(0, 6));
}

export function parseGatewayFeeEstimate(result: unknown) {
  const estimate = recordValue(result);
  const estimateBody = Array.isArray(result)
    ? result
    : Array.isArray(estimate?.body)
      ? estimate.body
      : null;
  const fees = recordValue(estimate?.fees);
  const first = recordValue(estimateBody?.[0]);
  const burnIntent = recordValue(first?.burnIntent);
  const estimatedMaxFee = burnIntent?.maxFee;
  const feeText = typeof fees?.total === "string" ? fees.total.trim() : "";
  const estimatedFeeAtomic = feeText ? parseWithdrawalUsdc(feeText) : null;

  if (
    (fees?.token != null && fees.token !== "USDC") ||
    typeof estimatedMaxFee !== "string" ||
    !/^\d+$/.test(estimatedMaxFee)
  ) {
    throw new Error("Gateway fee estimate returned an invalid response");
  }

  const quotedMaxFeeAtomic = BigInt(estimatedMaxFee);
  const baseFeeAtomic = estimatedFeeAtomic != null && quotedMaxFeeAtomic < estimatedFeeAtomic
    ? estimatedFeeAtomic
    : quotedMaxFeeAtomic;
  const percentageBuffer = (baseFeeAtomic + BigInt(9)) / BigInt(10);
  const feeBufferAtomic = percentageBuffer > MIN_FEE_BUFFER_ATOMIC
    ? percentageBuffer
    : MIN_FEE_BUFFER_ATOMIC;

  return {
    estimatedFeeAtomic: estimatedFeeAtomic ?? quotedMaxFeeAtomic,
    maxFeeAtomic: baseFeeAtomic + feeBufferAtomic,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
