import { getAddress, isAddress } from "viem";

export const ARC_TESTNET_NETWORK = "eip155:5042002";
export const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
export const ARC_TESTNET_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const MAX_EXTERNAL_PROOF_AMOUNT_ATOMIC = BigInt(100_000);

export type VerifiedExternalPayment = {
  payer: `0x${string}`;
  endpoint: string;
  amountAtomic: bigint;
  settlementReference: string;
};

export function verifyExternalPaymentProof(input: {
  body: unknown;
  expectedPayer: string;
  expectedReference?: string | null;
  expectedPayTo?: string | null;
  maxAmountAtomic?: bigint;
}): VerifiedExternalPayment {
  if (!isAddress(input.expectedPayer)) {
    throw new Error("Expected payer is not a valid EVM address.");
  }

  const root = recordValue(input.body);
  const payment = recordValue(root?.payment);
  if (!payment) throw new Error("Proof response is missing payment evidence.");

  const payer = requiredAddress(payment.payer, "payment payer");
  const verify = requiredRecord(payment.facilitatorVerify, "facilitator verification");
  const settle = requiredRecord(payment.facilitatorSettle, "facilitator settlement");
  const requirements = requiredRecord(payment.facilitatorRequirements, "payment requirements");
  const extra = requiredRecord(requirements.extra, "Gateway requirements");
  const expectedPayer = getAddress(input.expectedPayer);

  if (getAddress(payer) !== expectedPayer) {
    throw new Error(`Proof payer ${payer} does not match ${expectedPayer}.`);
  }
  if (verify.isValid !== true) {
    throw new Error("Circle facilitator verification is not valid.");
  }
  if (settle.success !== true) {
    throw new Error("Circle facilitator settlement is not successful.");
  }
  for (const [label, value] of [
    ["verification payer", verify.payer],
    ["settlement payer", settle.payer],
  ] as const) {
    const address = requiredAddress(value, label);
    if (getAddress(address) !== expectedPayer) {
      throw new Error(`${label} does not match the expected payer.`);
    }
  }

  const network = requiredText(payment.network, "payment network");
  const requirementsNetwork = requiredText(requirements.network, "requirements network");
  const settlementNetwork = requiredText(settle.network, "settlement network");
  if ([network, requirementsNetwork, settlementNetwork].some((value) => value !== ARC_TESTNET_NETWORK)) {
    throw new Error("Proof is not an Arc Testnet payment.");
  }

  const asset = requiredAddress(requirements.asset, "payment asset");
  const payTo = requiredAddress(requirements.payTo, "seller address");
  const contract = requiredAddress(extra.verifyingContract, "Gateway verifying contract");
  if (getAddress(asset) !== getAddress(ARC_TESTNET_USDC)) {
    throw new Error("Proof uses an unexpected payment asset.");
  }
  if (requirements.scheme !== "exact") {
    throw new Error("Proof does not use the exact x402 payment scheme.");
  }
  if (input.expectedPayTo && getAddress(payTo) !== getAddress(input.expectedPayTo)) {
    throw new Error("Proof paid an unexpected seller address.");
  }
  if (
    getAddress(contract) !== getAddress(ARC_TESTNET_GATEWAY_WALLET) ||
    extra.name !== "GatewayWalletBatched" ||
    String(extra.version) !== "1"
  ) {
    throw new Error("Proof does not use Circle Gateway batching on Arc Testnet.");
  }

  const amountText = requiredText(payment.amountAtomic, "atomic payment amount");
  const requirementAmount = requiredText(requirements.amount, "required atomic amount");
  if (!/^\d+$/.test(amountText) || amountText !== requirementAmount) {
    throw new Error("Proof amount is invalid or differs from the signed requirement.");
  }
  const amountAtomic = BigInt(amountText);
  const maxAmountAtomic = input.maxAmountAtomic ?? MAX_EXTERNAL_PROOF_AMOUNT_ATOMIC;
  if (amountAtomic <= BigInt(0) || amountAtomic > maxAmountAtomic) {
    throw new Error(`Proof amount exceeds the ${formatAtomic(maxAmountAtomic)} USDC verification cap.`);
  }

  const endpoint = requiredText(payment.endpoint, "Crux endpoint");
  if (!isCruxPaidEndpoint(endpoint)) {
    throw new Error(`Proof endpoint is not an allowed Crux paid resource: ${endpoint}`);
  }

  const settlementReference = requiredText(payment.settlementReference, "settlement reference");
  const settlementTransaction = requiredText(settle.transaction, "settlement transaction");
  if (settlementReference !== settlementTransaction) {
    throw new Error("Settlement reference does not match the facilitator response.");
  }
  if (input.expectedReference?.trim() && settlementReference !== input.expectedReference.trim()) {
    throw new Error("Proof URL reference does not match the payment evidence.");
  }

  return {
    payer: expectedPayer as `0x${string}`,
    endpoint,
    amountAtomic,
    settlementReference,
  };
}

export function proofReferenceFromUrl(proofUrl: URL, baseUrl: URL) {
  if (proofUrl.origin !== baseUrl.origin) {
    throw new Error("Proof URL must use the configured Crux origin.");
  }
  const prefix = "/api/payments/by-reference/";
  if (!proofUrl.pathname.startsWith(prefix)) {
    throw new Error("Proof URL must use Crux's public payment-proof endpoint.");
  }
  const encoded = proofUrl.pathname.slice(prefix.length);
  let reference: string;
  try {
    reference = decodeURIComponent(encoded).trim();
  } catch {
    throw new Error("Proof URL contains an invalid settlement reference.");
  }
  if (
    !reference ||
    reference.length > 512 ||
    reference.includes("/") ||
    /[\u0000-\u001f\u007f]/.test(reference) ||
    proofUrl.search ||
    proofUrl.hash
  ) {
    throw new Error("Proof URL contains an invalid settlement reference.");
  }
  return reference;
}

export function isCruxPaidEndpoint(endpoint: string) {
  return (
    /^\/api\/real\/[a-z0-9-]+$/i.test(endpoint) ||
    /^\/api\/research\/[a-z0-9-]+$/i.test(endpoint) ||
    [
      "/api/premium/quote",
      "/api/premium/dataset",
      "/api/premium/compute",
      "/api/premium/agent-task",
    ].includes(endpoint)
  );
}

function requiredRecord(value: unknown, label: string) {
  const record = recordValue(value);
  if (!record) throw new Error(`Proof is missing ${label}.`);
  return record;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Proof is missing ${label}.`);
  }
  return value.trim();
}

function requiredAddress(value: unknown, label: string) {
  const address = requiredText(value, label);
  if (!isAddress(address)) throw new Error(`Proof ${label} is not a valid EVM address.`);
  return address;
}

function formatAtomic(value: bigint) {
  const whole = value / BigInt(1_000_000);
  const fraction = (value % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
