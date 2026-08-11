import { createClient } from "@supabase/supabase-js";
import {
  ARC_TESTNET_CHAIN_ID,
  classifySettlementReference,
} from "./settlement.ts";
import { settlementReferencesFromPayload } from "./receipt-settlements.ts";

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
  facilitatorRequirements: FacilitatorRequirementsEvidence | null;
  facilitatorVerify: FacilitatorVerifyEvidence | null;
  facilitatorSettle: FacilitatorSettleEvidence | null;
};

const PROOF_SELECT =
  "id, created_at, endpoint, payer, amount_usdc, amount_atomic, network, gateway_tx, settlement_reference, settlement_kind, settlement_status, arc_tx_hash, arc_chain_id, arc_block_number, arc_confirmed_at, settlement_checked_at, facilitator_requirements, facilitator_verify, facilitator_settle";
const LEGACY_SELECT =
  "id, created_at, endpoint, payer, amount_usdc, network, gateway_tx";

export async function loadReceiptPaymentEvidence(payload: unknown) {
  return loadPaymentEvidence(settlementReferencesFromPayload(payload));
}

export async function loadPaymentEvidence(references: string[]): Promise<PaymentEvidence[]> {
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

    return dedupeRows([...(bySettlement.data ?? []), ...(byGateway.data ?? [])])
      .map(sanitizePaymentEvidenceRow);
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
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}
