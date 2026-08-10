const USDC_SCALE = BigInt(1_000_000);

export function usdcNumberToAtomic(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid USDC amount.");
  return BigInt(Math.round(value * Number(USDC_SCALE)));
}

export function usdcAtomicToNumber(value: bigint) {
  return Number(value) / Number(USDC_SCALE);
}

export function formatUsdcAtomic(value: bigint) {
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function parseAtomicAmount(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("x402 payment requirement has an invalid atomic amount.");
  }
  const amount = BigInt(value);
  if (amount <= BigInt(0)) throw new Error("x402 payment amount must be positive.");
  return amount;
}
