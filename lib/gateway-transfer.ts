import { getAddress, isAddress } from "viem";
import { isEvmTxHash } from "./settlement.ts";

const GATEWAY_X402_TRANSFERS_URL =
  "https://gateway-api-testnet.circle.com/v1/x402/transfers";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSFER_STATUSES = new Set([
  "received",
  "batched",
  "confirmed",
  "completed",
  "failed",
]);

export type GatewayTransferStatus =
  | "received"
  | "batched"
  | "confirmed"
  | "completed"
  | "failed";

export type GatewayX402Transfer = {
  id: string;
  status: GatewayTransferStatus;
  token: "USDC";
  sendingNetwork: string;
  recipientNetwork: string;
  fromAddress: `0x${string}`;
  toAddress: `0x${string}`;
  amount: string;
  nonce: string;
  txHash: `0x${string}` | null;
  createdAt: string;
  updatedAt: string;
};

export type GatewayTransferExpectation = {
  network?: string | null;
  payer?: string | null;
  payTo?: string | null;
  amountAtomic?: string | null;
};

export function isGatewayTransferReference(value?: string | null) {
  return Boolean(value?.trim() && UUID_PATTERN.test(value.trim()));
}

export function gatewayTransferUrl(reference?: string | null) {
  const normalized = reference?.trim();
  return normalized && isGatewayTransferReference(normalized)
    ? `${GATEWAY_X402_TRANSFERS_URL}/${encodeURIComponent(normalized)}`
    : null;
}

export async function fetchGatewayX402Transfer(
  reference: string,
  expected: GatewayTransferExpectation = {},
  fetcher: typeof fetch = fetch,
): Promise<GatewayX402Transfer | null> {
  const url = gatewayTransferUrl(reference);
  if (!url) return null;

  const response = await fetcher(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Circle Gateway transfer lookup failed with HTTP ${response.status}.`);
  }

  return parseGatewayX402Transfer(reference, await response.json(), expected);
}

export function parseGatewayX402Transfer(
  reference: string,
  value: unknown,
  expected: GatewayTransferExpectation = {},
): GatewayX402Transfer {
  const transfer = recordValue(value);
  if (!transfer) throw new Error("Circle Gateway transfer lookup returned invalid JSON.");

  const id = requiredText(transfer.id, "transfer id");
  if (id.toLowerCase() !== reference.trim().toLowerCase()) {
    throw new Error("Circle Gateway transfer id does not match the settlement reference.");
  }

  const status = requiredText(transfer.status, "transfer status");
  if (!TRANSFER_STATUSES.has(status)) {
    throw new Error(`Circle Gateway returned an unsupported transfer status: ${status}.`);
  }

  const token = requiredText(transfer.token, "transfer token");
  if (token !== "USDC") throw new Error(`Circle Gateway returned unexpected token ${token}.`);

  const sendingNetwork = requiredText(transfer.sendingNetwork, "sending network");
  const recipientNetwork = requiredText(transfer.recipientNetwork, "recipient network");
  if (
    expected.network &&
    (sendingNetwork !== expected.network || recipientNetwork !== expected.network)
  ) {
    throw new Error("Circle Gateway transfer network does not match the payment evidence.");
  }

  const fromAddress = requiredAddress(transfer.fromAddress, "payer address");
  const toAddress = requiredAddress(transfer.toAddress, "seller address");
  assertExpectedAddress(fromAddress, expected.payer, "payer");
  assertExpectedAddress(toAddress, expected.payTo, "seller");

  const amount = requiredUnsignedInteger(transfer.amount, "transfer amount");
  if (expected.amountAtomic?.trim() && amount !== expected.amountAtomic.trim()) {
    throw new Error("Circle Gateway transfer amount does not match the payment evidence.");
  }

  const nonce = requiredText(transfer.nonce, "transfer nonce");
  const rawTxHash = transfer.txHash;
  const txHash = rawTxHash == null ? null : requiredText(rawTxHash, "batch transaction hash");
  if (txHash && !isEvmTxHash(txHash)) {
    throw new Error("Circle Gateway returned an invalid batch transaction hash.");
  }

  return {
    id,
    status: status as GatewayTransferStatus,
    token: "USDC",
    sendingNetwork,
    recipientNetwork,
    fromAddress,
    toAddress,
    amount,
    nonce,
    txHash: txHash as `0x${string}` | null,
    createdAt: requiredText(transfer.createdAt, "created timestamp"),
    updatedAt: requiredText(transfer.updatedAt, "updated timestamp"),
  };
}

function assertExpectedAddress(
  actual: `0x${string}`,
  expected: string | null | undefined,
  label: string,
) {
  if (!expected?.trim()) return;
  if (!isAddress(expected) || getAddress(actual) !== getAddress(expected)) {
    throw new Error(`Circle Gateway transfer ${label} does not match the payment evidence.`);
  }
}

function requiredAddress(value: unknown, label: string) {
  const address = requiredText(value, label);
  if (!isAddress(address)) throw new Error(`Circle Gateway ${label} is invalid.`);
  return getAddress(address) as `0x${string}`;
}

function requiredUnsignedInteger(value: unknown, label: string) {
  const text = requiredText(value, label);
  if (!/^\d+$/.test(text)) throw new Error(`Circle Gateway ${label} is invalid.`);
  return text;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Circle Gateway response is missing ${label}.`);
  }
  return value.trim();
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
