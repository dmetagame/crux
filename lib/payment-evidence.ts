import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ARC_TESTNET_CHAIN_ID,
  classifySettlementReference,
} from "./settlement.ts";
import { gatewayTransferUrl } from "./gateway-transfer.ts";
import { settlementReferencesFromPayload } from "./receipt-settlements.ts";
import { resolveSettlementProof } from "./settlement-verifier.ts";

export type FacilitatorRequirementsEvidence = {
  scheme: string | null;
  network: string | null;
  asset: string | null;
  amount: string | null;
  payTo: string | null;
  maxTimeoutSeconds: number | null;
  extra: {
    name: string | null;
    version: string | null;
    verifyingContract: string | null;
  } | null;
};

export type FacilitatorVerifyEvidence = {
  isValid: boolean | null;
  invalidReason: string | null;
  payer: string | null;
};

export type FacilitatorSettleEvidence = {
  success: boolean | null;
  errorReason: string | null;
  payer: string | null;
  transaction: string | null;
  network: string | null;
};

export type GatewayTransferEvidence = {
  id: string;
  status: string;
  fromAddress: string;
  toAddress: string;
  amountAtomic: string;
  nonce: string;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArcBatchEvidence = {
  batchId: string;
  signer: string;
  tokenAddress: string;
  domain: number;
  gatewayWalletAddress: string;
  deltaCount: number;
  netDeltaAtomic: string;
  payerDeltaAtomic: string | null;
  payToDeltaAtomic: string | null;
  expectedAmountAtomic: string;
  containsExpectedDeltas: boolean;
  exactExpectedDeltas: boolean;
};

export type PaymentEvidence = {
  id: string | null;
  createdAt: string | null;
  endpoint: string | null;
  payer: string | null;
  amountUsdc: string | null;
  amountAtomic: string | null;
  network: string | null;
  settlementReference: string | null;
  settlementKind: string;
  settlementStatus: string;
  arcTxHash: string | null;
  arcChainId: number | null;
  arcBlockNumber: string | null;
  arcConfirmedAt: string | null;
  settlementCheckedAt: string | null;
  gatewayTransferStatus: string | null;
  gatewayTransferUrl: string | null;
  gatewayTransfer: GatewayTransferEvidence | null;
  arcBatchEvidence: ArcBatchEvidence | null;
  facilitatorRequirements: FacilitatorRequirementsEvidence | null;
  facilitatorVerify: FacilitatorVerifyEvidence | null;
  facilitatorSettle: FacilitatorSettleEvidence | null;
};

const PROOF_SELECT =
  "id, created_at, endpoint, payer, amount_usdc, amount_atomic, network, gateway_tx, settlement_reference, settlement_kind, settlement_status, arc_tx_hash, arc_chain_id, arc_block_number, arc_confirmed_at, settlement_checked_at, facilitator_requirements, facilitator_verify, facilitator_settle";
const LEGACY_SELECT =
  "id, created_at, endpoint, payer, amount_usdc, network, gateway_tx";

export async function loadReceiptPaymentEvidence(
  payload: unknown,
  options: { refreshGateway?: boolean } = {},
) {
  return loadPaymentEvidence(settlementReferencesFromPayload(payload), options);
}

export async function loadPaymentEvidence(
  references: string[],
  options: { refreshGateway?: boolean } = {},
): Promise<PaymentEvidence[]> {
  const unique = [...new Set(references.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
  if (unique.length === 0) return [];

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const [bySettlement, byGateway] = await Promise.all([
      supabase
        .from("payment_events")
        .select(PROOF_SELECT)
        .in("settlement_reference", unique)
        .order("created_at", { ascending: true }),
      supabase
        .from("payment_events")
        .select(PROOF_SELECT)
        .in("gateway_tx", unique)
        .order("created_at", { ascending: true }),
    ]);

    if (bySettlement.error || byGateway.error) {
      const message = bySettlement.error?.message ?? byGateway.error?.message ?? "unknown payment evidence error";
      if (!isProofColumnError(message)) throw new Error(message);
      const legacy = await supabase
        .from("payment_events")
        .select(LEGACY_SELECT)
        .in("gateway_tx", unique)
        .order("created_at", { ascending: true });
      if (legacy.error) throw new Error(legacy.error.message);
      return dedupeRows(legacy.data ?? []).map(sanitizePaymentEvidenceRow);
    }

    const rows = dedupeRows([...(bySettlement.data ?? []), ...(byGateway.data ?? [])]);
    const refreshed = options.refreshGateway
      ? await Promise.all(rows.map((row) => refreshGatewayEvidenceRow(supabase, row)))
      : rows;
    return refreshed.map(sanitizePaymentEvidenceRow);
  } catch (err) {
    console.warn("[receipt] Could not load payment evidence:", (err as Error).message);
    return [];
  }
}

export function sanitizePaymentEvidenceRow(row: Record<string, unknown>): PaymentEvidence {
  const settlementReference = text(row.settlement_reference, 512) ?? text(row.gateway_tx, 512);
  const classified = classifySettlementReference(settlementReference);
  const requirements = recordValue(row.facilitator_requirements);
  const requirementsExtra = recordValue(requirements?.extra);
  const verify = recordValue(row.facilitator_verify);
  const settle = recordValue(row.facilitator_settle);

  return {
    id: text(row.id, 128),
    createdAt: text(row.created_at, 128),
    endpoint: text(row.endpoint, 512),
    payer: text(row.payer, 128),
    amountUsdc: scalarText(row.amount_usdc, 64),
    amountAtomic: scalarText(row.amount_atomic, 64),
    network: text(row.network, 128),
    settlementReference,
    settlementKind: text(row.settlement_kind, 64) ?? classified.settlementKind,
    settlementStatus: text(row.settlement_status, 64) ?? classified.settlementStatus,
    arcTxHash: text(row.arc_tx_hash, 128) ?? classified.arcTxHash,
    arcChainId: finiteNumber(row.arc_chain_id) ?? (classified.arcTxHash ? ARC_TESTNET_CHAIN_ID : null),
    arcBlockNumber: row.arc_block_number == null ? null : text(String(row.arc_block_number), 64),
    arcConfirmedAt: text(row.arc_confirmed_at, 128),
    settlementCheckedAt: text(row.settlement_checked_at, 128),
    gatewayTransferStatus: text(row.gateway_transfer_status, 64),
    gatewayTransferUrl: gatewayTransferUrl(settlementReference),
    gatewayTransfer: sanitizeGatewayTransferEvidence(recordValue(row.gateway_transfer)),
    arcBatchEvidence: sanitizeArcBatchEvidence(recordValue(row.arc_batch_evidence)),
    facilitatorRequirements: requirements
      ? {
          scheme: text(requirements.scheme, 64),
          network: text(requirements.network, 128),
          asset: text(requirements.asset, 128),
          amount: text(requirements.amount, 64),
          payTo: text(requirements.payTo, 128),
          maxTimeoutSeconds: finiteNumber(requirements.maxTimeoutSeconds),
          extra: requirementsExtra
            ? {
                name: text(requirementsExtra.name, 128),
                version: text(requirementsExtra.version, 64),
                verifyingContract: text(requirementsExtra.verifyingContract, 128),
              }
            : null,
        }
      : null,
    facilitatorVerify: verify
      ? {
          isValid: booleanValue(verify.isValid),
          invalidReason: text(verify.invalidReason, 512),
          payer: text(verify.payer, 128),
        }
      : null,
    facilitatorSettle: settle
      ? {
          success: booleanValue(settle.success),
          errorReason: text(settle.errorReason, 512),
          payer: text(settle.payer, 128),
          transaction: text(settle.transaction, 512),
          network: text(settle.network, 128),
        }
      : null,
  };
}

async function refreshGatewayEvidenceRow(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
) {
  const reference = text(row.settlement_reference, 512) ?? text(row.gateway_tx, 512);
  const classified = classifySettlementReference(reference);
  if (
    !reference ||
    classified.settlementKind !== "gateway_settlement_reference"
  ) {
    return row;
  }

  const requirements = recordValue(row.facilitator_requirements);
  const resolution = await resolveSettlementProof(reference, {
    resolveGatewayReference: true,
    expectedGatewayTransfer: {
      network: text(row.network, 128) ?? text(requirements?.network, 128),
      payer: text(row.payer, 128),
      payTo: text(requirements?.payTo, 128),
      amountAtomic:
        scalarText(row.amount_atomic, 64) ?? text(requirements?.amount, 64),
    },
    knownArcTxHash: text(row.arc_tx_hash, 128),
  });
  const storedArcHash = text(row.arc_tx_hash, 128);
  const storedArcConfirmed =
    storedArcHash && text(row.settlement_status, 64) === "arc_confirmed";
  const refreshedArcTerminal = ["arc_confirmed", "arc_failed"].includes(
    resolution.columns.settlement_status,
  );
  const applyResolution = !storedArcConfirmed || refreshedArcTerminal;
  const merged = {
    ...row,
    ...(applyResolution ? resolution.columns : {}),
    gateway_transfer_status: resolution.gatewayTransferStatus,
    gateway_transfer: resolution.gatewayTransfer,
    arc_batch_evidence: resolution.arcBatchEvidence,
  };

  const id = text(row.id, 128);
  if (
    id &&
    resolution.columns.arc_tx_hash &&
    applyResolution &&
    settlementProofChanged(row, resolution.columns)
  ) {
    const { error } = await supabase
      .from("payment_events")
      .update(resolution.columns)
      .eq("id", id);
    if (error) {
      console.warn(
        "[receipt] Could not persist refreshed settlement evidence:",
        error.message,
      );
    }
  }

  return merged;
}

function sanitizeGatewayTransferEvidence(
  value: Record<string, unknown> | null,
): GatewayTransferEvidence | null {
  if (!value) return null;
  const id = text(value.id, 64);
  const status = text(value.status, 64);
  const fromAddress = text(value.fromAddress, 128);
  const toAddress = text(value.toAddress, 128);
  const amountAtomic = scalarText(value.amount, 64);
  const nonce = text(value.nonce, 128);
  const createdAt = text(value.createdAt, 128);
  const updatedAt = text(value.updatedAt, 128);
  if (
    !id ||
    !status ||
    !fromAddress ||
    !toAddress ||
    !amountAtomic ||
    !nonce ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  return {
    id,
    status,
    fromAddress,
    toAddress,
    amountAtomic,
    nonce,
    txHash: text(value.txHash, 128),
    createdAt,
    updatedAt,
  };
}

function sanitizeArcBatchEvidence(
  value: Record<string, unknown> | null,
): ArcBatchEvidence | null {
  if (!value) return null;
  const batchId = text(value.batchId, 128);
  const signer = text(value.signer, 128);
  const tokenAddress = text(value.tokenAddress, 128);
  const domain = finiteNumber(value.domain);
  const gatewayWalletAddress = text(value.gatewayWalletAddress, 128);
  const deltaCount = finiteNumber(value.deltaCount);
  const netDeltaAtomic = scalarText(value.netDeltaAtomic, 64);
  const expectedAmountAtomic = scalarText(value.expectedAmountAtomic, 64);
  const containsExpectedDeltas = booleanValue(value.containsExpectedDeltas);
  const exactExpectedDeltas = booleanValue(value.exactExpectedDeltas);
  if (
    !batchId ||
    !signer ||
    !tokenAddress ||
    domain === null ||
    !gatewayWalletAddress ||
    deltaCount === null ||
    !netDeltaAtomic ||
    !expectedAmountAtomic ||
    containsExpectedDeltas === null ||
    exactExpectedDeltas === null
  ) {
    return null;
  }
  return {
    batchId,
    signer,
    tokenAddress,
    domain,
    gatewayWalletAddress,
    deltaCount,
    netDeltaAtomic,
    payerDeltaAtomic: scalarText(value.payerDeltaAtomic, 64),
    payToDeltaAtomic: scalarText(value.payToDeltaAtomic, 64),
    expectedAmountAtomic,
    containsExpectedDeltas,
    exactExpectedDeltas,
  };
}

function settlementProofChanged(
  row: Record<string, unknown>,
  columns: Awaited<ReturnType<typeof resolveSettlementProof>>["columns"],
) {
  return (
    text(row.settlement_reference, 512) !== columns.settlement_reference ||
    text(row.settlement_kind, 64) !== columns.settlement_kind ||
    text(row.settlement_status, 64) !== columns.settlement_status ||
    text(row.arc_tx_hash, 128)?.toLowerCase() !== columns.arc_tx_hash?.toLowerCase() ||
    finiteNumber(row.arc_chain_id) !== columns.arc_chain_id ||
    scalarText(row.arc_block_number, 64) !== columns.arc_block_number ||
    normalizedTimestamp(row.arc_confirmed_at) !== normalizedTimestamp(columns.arc_confirmed_at)
  );
}

function normalizedTimestamp(value: unknown) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dedupeRows(rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = text(row.id, 128) ?? [row.gateway_tx, row.endpoint, row.created_at].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isProofColumnError(message: string) {
  return /amount_atomic|facilitator_|settlement_|arc_tx_hash|arc_chain_id|arc_block_number|arc_confirmed_at/.test(message);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function scalarText(value: unknown, maxLength: number) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, maxLength);
  return text(value, maxLength);
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}
