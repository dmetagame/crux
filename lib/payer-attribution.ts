export type PaymentActorCategory = "house" | "visitor" | "externalX402" | "unattributed";

export function classifyPaymentActor(input: {
  payer?: string | null;
  receiptPayerKind?: string | null;
  houseAddresses: Set<string>;
  visitorAddresses: Set<string>;
  externalAddresses: Set<string>;
}): PaymentActorCategory {
  if (input.receiptPayerKind === "visitor-wallet") return "visitor";
  if (["house-wallet", "trusted-agent"].includes(input.receiptPayerKind ?? "")) return "house";

  const payer = normalizePayer(input.payer);
  if (!payer) return "unattributed";
  if (input.visitorAddresses.has(payer)) return "visitor";
  if (input.houseAddresses.has(payer)) return "house";
  if (input.externalAddresses.has(payer)) return "externalX402";
  return "unattributed";
}

export function normalizePayer(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
