import type { SupabaseClient } from "@supabase/supabase-js";
import { alertErrorMessage } from "./alerts.ts";
import {
  ARC_TESTNET_CHAIN_ID,
  classifySettlementReference,
  type SettlementKind,
  type SettlementStatus,
} from "./settlement.ts";
import {
  buildSettlementProofColumns,
  resolveSettlementProof,
  type SettlementProofColumns,
} from "./settlement-verifier.ts";
import { getSellerAddress } from "./wallet-keys.ts";

export type PaymentReconciliationIssueCode =
  | "missing_settlement_reference"
  | "settlement_kind_mismatch"
  | "settlement_status_mismatch"
  | "arc_tx_hash_mismatch"
  | "arc_chain_mismatch"
  | "arc_tx_failed"
  | "arc_tx_unverified"
  | "gateway_transfer_failed"
  | "gateway_transfer_lookup_failed"
  | "gateway_tx_missing"
  | "stale_settlement_check"
  | "unexpected_network"
  | "payment_event_update_failed";

export type PaymentReconciliationIssue = {
  code: PaymentReconciliationIssueCode;
  severity: "warning" | "critical";
  eventId: string;
  createdAt: string;
  endpoint: string;
  message: string;
  settlementReference: string | null;
};

export type PaymentReconciliationSummary = {
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  checked: number;
  updated: number;
  issueCount: number;
  criticalCount: number;
  warningCount: number;
  issueCodes: Record<string, number>;
  issues: PaymentReconciliationIssue[];
  generatedAt: string;
};

type PaymentEventRow = {
  id: string;
  created_at: string;
  endpoint: string;
  payer: string;
  amount_usdc: string;
  amount_atomic: string | null;
  network: string;
  gateway_tx: string | null;
  settlement_reference: string | null;
  settlement_kind: SettlementKind | null;
  settlement_status: SettlementStatus | null;
  arc_tx_hash: string | null;
  arc_chain_id: number | null;
  arc_block_number: string | number | null;
  arc_confirmed_at: string | null;
  settlement_checked_at: string | null;
};

const PAYMENT_SELECT =
  "id, created_at, endpoint, payer, amount_usdc, amount_atomic, network, gateway_tx, settlement_reference, settlement_kind, settlement_status, arc_tx_hash, arc_chain_id, arc_block_number, arc_confirmed_at, settlement_checked_at";
const ARC_TESTNET_NETWORK = "eip155:5042002";
const DEFAULT_LIMIT = 250;
const DEFAULT_STALE_HOURS = 24;

export async function reconcilePayments(
  supabase: SupabaseClient,
  opts: {
    limit?: number;
    staleHours?: number;
    dryRun?: boolean;
  } = {},
): Promise<PaymentReconciliationSummary> {
  const limit = clampInteger(opts.limit ?? DEFAULT_LIMIT, 1, 1_000);
  const staleHours = Math.max(1, opts.staleHours ?? DEFAULT_STALE_HOURS);
  const dryRun = Boolean(opts.dryRun);

  const { data, error } = await supabase
    .from("payment_events")
    .select(PAYMENT_SELECT)
    .order("arc_tx_hash", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load payment events: ${error.message}`);
  }

  const rows = (data ?? []) as PaymentEventRow[];
  const issues: PaymentReconciliationIssue[] = [];
  let checked = 0;
  let updated = 0;

  const results = await mapWithConcurrency(rows, 8, (row) =>
    reconcilePaymentRow(supabase, row, { staleHours, dryRun }),
  );

  for (const rowIssues of results) {
    checked += 1;
    if (rowIssues.updated) updated += 1;
    issues.push(...rowIssues.issues);
  }

  const issueCodes = countIssueCodes(issues);
  const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
  const warningCount = issues.length - criticalCount;

  return {
    ok: criticalCount === 0 && warningCount === 0,
    dryRun,
    scanned: rows.length,
    checked,
    updated,
    issueCount: issues.length,
    criticalCount,
    warningCount,
    issueCodes,
    issues: issues.slice(0, 50),
    generatedAt: new Date().toISOString(),
  };
}

export function paymentReconciliationAlertSummary(
  summary: PaymentReconciliationSummary,
) {
  const codes = Object.entries(summary.issueCodes)
    .map(([code, count]) => `${code}:${count}`)
    .join(", ");

  return (
    `${summary.issueCount} payment reconciliation issue` +
    `${summary.issueCount === 1 ? "" : "s"} across ${summary.scanned} checked payments` +
    `${codes ? ` (${codes})` : ""}`
  );
}

async function reconcilePaymentRow(
  supabase: SupabaseClient,
  row: PaymentEventRow,
  opts: {
    staleHours: number;
    dryRun: boolean;
  },
) {
  const issues: PaymentReconciliationIssue[] = [];
  const reference = bestSettlementReference(row);
  const classified = classifySettlementReference(reference);

  if (row.network !== ARC_TESTNET_NETWORK) {
    issues.push(issue(row, "unexpected_network", "critical", `Unexpected payment network ${row.network}.`));
  }

  if (!classified.settlementReference) {
    issues.push(
      issue(
        row,
        "missing_settlement_reference",
        "critical",
        "Payment event has no settlement reference or gateway transaction.",
      ),
    );
  }

  let resolution;
  try {
    resolution = await resolveSettlementProof(classified.settlementReference, {
      resolveGatewayReference: true,
      strictGatewayResolution: true,
      expectedGatewayTransfer: {
        network: row.network,
        payer: row.payer,
        payTo: safeSellerAddress(),
        amountAtomic: row.amount_atomic ?? decimalToAtomic(row.amount_usdc),
      },
    });
  } catch (error) {
    const message = (error as Error).message;
    issues.push(
      issue(
        row,
        "gateway_transfer_lookup_failed",
        /does not match|unexpected|invalid|missing/i.test(message) ? "critical" : "warning",
        `Circle Gateway transfer lookup failed: ${message}`,
        classified.settlementReference,
      ),
    );
    resolution = {
      columns: await buildSettlementProofColumns(classified.settlementReference),
      gatewayTransferStatus: null,
    };
  }
  const proof = resolution.columns;
  const expectedStatus = proof.settlement_status;
  const expectedArcHash = proof.arc_tx_hash;

  if (resolution.gatewayTransferStatus === "failed") {
    issues.push(
      issue(
        row,
        "gateway_transfer_failed",
        "critical",
        "Circle Gateway reports that the x402 transfer failed.",
        proof.settlement_reference,
      ),
    );
  }
  if (
    ["confirmed", "completed"].includes(resolution.gatewayTransferStatus ?? "") &&
    !expectedArcHash
  ) {
    issues.push(
      issue(
        row,
        "gateway_tx_missing",
        "warning",
        "Circle Gateway reports completion without a batch transaction hash.",
        proof.settlement_reference,
      ),
    );
  }

  if (
    expectedArcHash &&
    row.arc_chain_id !== null &&
    row.arc_chain_id !== ARC_TESTNET_CHAIN_ID
  ) {
    issues.push(
      issue(
        row,
        "arc_chain_mismatch",
        "critical",
        `Stored Arc chain id ${row.arc_chain_id} should be ${ARC_TESTNET_CHAIN_ID}.`,
        proof.settlement_reference,
      ),
    );
  }

  if (expectedStatus === "arc_failed") {
    issues.push(
      issue(
        row,
        "arc_tx_failed",
        "critical",
        "Arc transaction receipt exists but failed.",
        proof.settlement_reference,
      ),
    );
  } else if (expectedStatus === "arc_unverified") {
    issues.push(
      issue(
        row,
        "arc_tx_unverified",
        "warning",
        "Arc transaction hash could not be verified by RPC.",
        proof.settlement_reference,
      ),
    );
  }

  const stale = isStale(row.settlement_checked_at, opts.staleHours);
  const updates = settlementUpdates(row, proof, stale);
  let updated = false;
  if (Object.keys(updates).length > 0 && opts.dryRun) {
    issues.push(...repairableIssues(row, proof, updates, opts.staleHours));
  } else if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("payment_events")
      .update(updates)
      .eq("id", row.id);
    if (error) {
      issues.push(
        issue(
          row,
          "payment_event_update_failed",
          "critical",
          `Payment event proof update failed: ${alertErrorMessage(error)}`,
          proof.settlement_reference,
        ),
      );
      issues.push(...repairableIssues(row, proof, updates, opts.staleHours));
    } else {
      updated = true;
    }
  }

  return { issues, updated };
}

function bestSettlementReference(row: PaymentEventRow) {
  return (
    row.settlement_reference?.trim() ||
    row.gateway_tx?.trim() ||
    row.arc_tx_hash?.trim() ||
    null
  );
}

function settlementUpdates(
  row: PaymentEventRow,
  proof: SettlementProofColumns,
  refreshCheckedAt: boolean,
) {
  const updates: Partial<SettlementProofColumns> = {};
  assignIfChanged(updates, row, "settlement_reference", proof.settlement_reference);
  assignIfChanged(updates, row, "settlement_kind", proof.settlement_kind);
  assignIfChanged(updates, row, "settlement_status", proof.settlement_status);
  assignIfChanged(updates, row, "arc_tx_hash", proof.arc_tx_hash);
  assignIfChanged(updates, row, "arc_chain_id", proof.arc_chain_id);
  assignIfChanged(
    updates,
    row,
    "arc_block_number",
    proof.arc_block_number,
    (value) => (value === null || value === undefined ? null : String(value)),
  );
  assignIfChanged(updates, row, "arc_confirmed_at", proof.arc_confirmed_at);
  if (refreshCheckedAt || Object.keys(updates).length > 0) {
    assignIfChanged(updates, row, "settlement_checked_at", proof.settlement_checked_at);
  }
  return updates;
}

function repairableIssues(
  row: PaymentEventRow,
  proof: SettlementProofColumns,
  updates: Partial<SettlementProofColumns>,
  staleHours: number,
) {
  const issues: PaymentReconciliationIssue[] = [];
  if (updates.settlement_kind !== undefined) {
    issues.push(
      issue(
        row,
        "settlement_kind_mismatch",
        "warning",
        `Stored settlement kind ${row.settlement_kind ?? "none"} should be ${proof.settlement_kind}.`,
        proof.settlement_reference,
      ),
    );
  }
  if (updates.settlement_status !== undefined) {
    issues.push(
      issue(
        row,
        "settlement_status_mismatch",
        proof.settlement_status === "arc_failed" ? "critical" : "warning",
        `Stored settlement status ${row.settlement_status ?? "recorded"} should be ${proof.settlement_status}.`,
        proof.settlement_reference,
      ),
    );
  }
  if (updates.arc_tx_hash !== undefined) {
    issues.push(
      issue(
        row,
        "arc_tx_hash_mismatch",
        "warning",
        "Stored Arc transaction hash does not match the settlement reference.",
        proof.settlement_reference,
      ),
    );
  }
  if (updates.arc_chain_id !== undefined) {
    issues.push(
      issue(
        row,
        "arc_chain_mismatch",
        "critical",
        `Stored Arc chain id ${row.arc_chain_id ?? "none"} should be ${proof.arc_chain_id ?? "none"}.`,
        proof.settlement_reference,
      ),
    );
  }
  if (
    updates.settlement_checked_at !== undefined &&
    Object.keys(updates).length === 1
  ) {
    issues.push(
      issue(
        row,
        "stale_settlement_check",
        "warning",
        `Settlement proof has not been checked in at least ${staleHours} hour(s).`,
        proof.settlement_reference,
      ),
    );
  }
  return issues;
}

function assignIfChanged<K extends keyof SettlementProofColumns>(
  updates: Partial<SettlementProofColumns>,
  row: PaymentEventRow,
  key: K,
  value: SettlementProofColumns[K],
  normalize: (value: unknown) => unknown = (input) => input ?? null,
) {
  if (normalize(row[key as keyof PaymentEventRow]) !== normalize(value)) {
    updates[key] = value;
  }
}

function issue(
  row: PaymentEventRow,
  code: PaymentReconciliationIssueCode,
  severity: "warning" | "critical",
  message: string,
  settlementReference = bestSettlementReference(row),
): PaymentReconciliationIssue {
  return {
    code,
    severity,
    eventId: row.id,
    createdAt: row.created_at,
    endpoint: row.endpoint,
    message,
    settlementReference,
  };
}

function countIssueCodes(issues: PaymentReconciliationIssue[]) {
  return issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.code] = (acc[issue.code] ?? 0) + 1;
    return acc;
  }, {});
}

function safeSellerAddress() {
  try {
    return getSellerAddress();
  } catch {
    return null;
  }
}

function decimalToAtomic(value: string) {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  return (BigInt(whole) * BigInt(1_000_000) + BigInt((fraction + "000000").slice(0, 6))).toString();
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  run: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await run(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

function isStale(value: string | null, staleHours: number) {
  if (!value) return true;
  const checkedAt = new Date(value).getTime();
  if (!Number.isFinite(checkedAt)) return true;
  return Date.now() - checkedAt > staleHours * 60 * 60 * 1000;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
