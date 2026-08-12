import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyPaymentActor, normalizePayer } from "@/lib/payer-attribution";
import { settlementReferencesFromPayload } from "@/lib/receipt-settlements";
import {
  getHistoricalHouseAddresses,
  getHouseAddress,
  getKnownExternalX402Addresses,
} from "@/lib/wallet-keys";
import { ARC_TESTNET_CHAIN_ID, classifySettlementReference } from "@/lib/settlement";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";
import { aggregateRunMetrics, type MetricsRunRow } from "@/lib/run-metrics";

export const maxDuration = 15;

const MICRO_USDC = BigInt(1_000_000);
const WINDOW_SECONDS = 24 * 60 * 60;

export async function GET(req: NextRequest) {
  const rate = await consumeRateLimit({
    key: limitKey("public:stats", clientIp(req)),
    limit: 60,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Stats rate limit reached." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const [paymentRows, walletRows, runRows] = await Promise.all([
      loadPaymentRows(supabase),
      supabase.from("user_wallets").select("address"),
      supabase.from("run_receipts").select("status, budget_usdc, spent_usdc, payer_kind, payload, created_at"),
    ]);

    if (paymentRows.error) throw paymentRows.error;
    if (walletRows.error && !/user_wallets|relation|does not exist/i.test(walletRows.error.message)) {
      throw walletRows.error;
    }
    if (runRows.error && !/run_receipts|relation|does not exist/i.test(runRows.error.message)) {
      throw runRows.error;
    }

    const payments = (paymentRows.data ?? []) as PaymentRow[];
    const payerSet = new Set(
      payments
        .map((row) => row.payer?.trim().toLowerCase())
        .filter((payer): payer is string => Boolean(payer)),
    );
    const walletAddresses = new Set(
      (walletRows.data ?? [])
        .map((row) => row.address?.trim().toLowerCase())
        .filter((address): address is string => Boolean(address)),
    );
    const runData = (runRows.data ?? []) as RunRow[];
    const receiptKinds = receiptPayerKinds(runData);
    const houseAddresses = safeHouseAddresses();
    const visitorAddresses = new Set(walletAddresses);
    inferReceiptPayerAddresses(payments, receiptKinds, houseAddresses, visitorAddresses);
    const externalAddresses = new Set(
      [...safeExternalAddresses()].filter(
        (address) => !houseAddresses.has(address) && !visitorAddresses.has(address),
      ),
    );
    const attribution = { houseAddresses, visitorAddresses, externalAddresses, receiptKinds };
    const paymentTotals = aggregatePayments(payments, attribution);
    const runs = aggregateRunMetrics(runData);
    const recent = payments.slice(0, 8).map(normalizeRecentPayment);
    const last24h = aggregatePayments(
      payments.filter((row) => Date.now() - Date.parse(row.created_at) <= WINDOW_SECONDS * 1000),
      attribution,
    );
    const paidVisitorWallets = new Set(
      [...payerSet].filter((payer) => walletAddresses.has(payer)),
    );
    const paidExternalPayers = new Set(
      [...payerSet].filter((payer) => externalAddresses.has(payer)),
    );

    return NextResponse.json(
      {
        statsVersion: "2026-08-13",
        totalPayments: paymentTotals.payments,
        totalAtomicUsdc: paymentTotals.atomic.toString(),
        totalUsdc: atomicToNumber(paymentTotals.atomic),
        avgUsdc: paymentTotals.payments ? atomicToNumber(paymentTotals.atomic) / paymentTotals.payments : 0,
        distinctPayers: payerSet.size,
        onboardedWallets: paidVisitorWallets.size,
        actorCategories: paymentTotals.actorCategories,
        independentExternalPayments: paymentTotals.actorCategories.externalX402,
        independentExternalPayers: paidExternalPayers.size,
        payerAttributionCoverage: paymentTotals.payments
          ? (paymentTotals.payments - paymentTotals.actorCategories.unattributed) / paymentTotals.payments
          : 0,
        completedTasks: runs.completed,
        recoveredTasks: runs.recovered,
        costPerCompletedTaskUsdc: runs.completed ? atomicToNumber(runs.spent) / runs.completed : 0,
        budgetUtilization: runs.budget > BigInt(0) ? Number(runs.spent * BigInt(10000) / runs.budget) / 10000 : 0,
        runActorCategories: runs.actorCategories,
        last24h: {
          payments: last24h.payments,
          totalAtomicUsdc: last24h.atomic.toString(),
          totalUsdc: atomicToNumber(last24h.atomic),
          actorCategories: last24h.actorCategories,
        },
        recent,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Stats are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

type PaymentRow = {
  amount_usdc: string;
  amount_atomic?: string | null;
  payer: string | null;
  endpoint: string;
  gateway_tx: string | null;
  settlement_reference?: string | null;
  settlement_kind?: string | null;
  settlement_status?: string | null;
  arc_tx_hash?: string | null;
  arc_chain_id?: number | null;
  arc_block_number?: string | number | null;
  arc_confirmed_at?: string | null;
  created_at: string;
};

async function loadPaymentRows(supabase: SupabaseClient) {
  const select =
    "amount_usdc, amount_atomic, payer, endpoint, gateway_tx, settlement_reference, settlement_kind, settlement_status, arc_tx_hash, arc_chain_id, arc_block_number, arc_confirmed_at, created_at";
  const result = await loadAllPayments(supabase, select);
  if (!result.error || !/amount_atomic|facilitator_|settlement_|arc_tx_hash/i.test(result.error.message)) return result;
  return loadAllPayments(supabase, "amount_usdc, payer, endpoint, gateway_tx, created_at");
}

async function loadAllPayments(supabase: SupabaseClient, select: string) {
  const pageSize = 1000;
  const data: PaymentRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await supabase
      .from("payment_events")
      .select(select)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const page = (result.data ?? []) as unknown as PaymentRow[];
    data.push(...page);
    if (page.length < pageSize) return { data, error: null };
  }
}

type PaymentAttribution = {
  houseAddresses: Set<string>;
  visitorAddresses: Set<string>;
  externalAddresses: Set<string>;
  receiptKinds: Map<string, string>;
};

function aggregatePayments(rows: PaymentRow[], attribution: PaymentAttribution) {
  let atomic = BigInt(0);
  const actorCategories = { house: 0, visitor: 0, externalX402: 0, unattributed: 0 };
  for (const row of rows) {
    atomic += rowAmountAtomic(row);
    const reference = paymentReference(row);
    const category = classifyPaymentActor({
      payer: row.payer,
      receiptPayerKind: reference ? attribution.receiptKinds.get(reference) : null,
      houseAddresses: attribution.houseAddresses,
      visitorAddresses: attribution.visitorAddresses,
      externalAddresses: attribution.externalAddresses,
    });
    actorCategories[category] += 1;
  }
  return { payments: rows.length, atomic, actorCategories };
}

type RunRow = MetricsRunRow;

function rowAmountAtomic(row: PaymentRow) {
  if (typeof row.amount_atomic === "string" && /^\d+$/.test(row.amount_atomic)) return BigInt(row.amount_atomic);
  return decimalToAtomic(row.amount_usdc);
}

function decimalToAtomic(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return BigInt(0);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * MICRO_USDC + BigInt((fraction + "000000").slice(0, 6));
}

function atomicToNumber(value: bigint) {
  return Number(value) / Number(MICRO_USDC);
}

function safeHouseAddresses() {
  const addresses = new Set<string>();
  try {
    addresses.add(getHouseAddress().toLowerCase());
  } catch (err) {
    console.warn("[stats] Current house address unavailable:", (err as Error).message);
  }
  try {
    for (const address of getHistoricalHouseAddresses()) addresses.add(address.toLowerCase());
  } catch (err) {
    console.warn("[stats] Invalid historical house address configuration:", (err as Error).message);
  }
  return addresses;
}

function safeExternalAddresses() {
  try {
    return new Set(getKnownExternalX402Addresses().map((address) => address.toLowerCase()));
  } catch (err) {
    console.warn("[stats] Invalid external payer configuration:", (err as Error).message);
    return new Set<string>();
  }
}

function receiptPayerKinds(rows: RunRow[]) {
  const kinds = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const row of rows) {
    const kind = String(row.payer_kind ?? "house-wallet");
    for (const reference of settlementReferencesFromPayload(row.payload)) {
      const existing = kinds.get(reference);
      if (existing && existing !== kind) {
        conflicts.add(reference);
      } else {
        kinds.set(reference, kind);
      }
    }
  }
  for (const reference of conflicts) kinds.delete(reference);
  return kinds;
}

function inferReceiptPayerAddresses(
  payments: PaymentRow[],
  receiptKinds: Map<string, string>,
  houseAddresses: Set<string>,
  visitorAddresses: Set<string>,
) {
  for (const row of payments) {
    const reference = paymentReference(row);
    const payer = normalizePayer(row.payer);
    if (!reference || !payer) continue;
    const kind = receiptKinds.get(reference);
    if (kind === "visitor-wallet") visitorAddresses.add(payer);
    else if (kind === "house-wallet" || kind === "trusted-agent") houseAddresses.add(payer);
  }
}

function paymentReference(row: PaymentRow) {
  return row.settlement_reference?.trim() || row.gateway_tx?.trim() || row.arc_tx_hash?.trim() || null;
}

function normalizeRecentPayment(row: PaymentRow) {
  const classified = classifySettlementReference(row.settlement_reference ?? row.gateway_tx);
  return {
    amount: atomicToNumber(rowAmountAtomic(row)),
    endpoint: row.endpoint,
    tx: row.gateway_tx,
    settlementReference: row.settlement_reference ?? classified.settlementReference,
    settlementKind: row.settlement_kind ?? classified.settlementKind,
    settlementStatus: row.settlement_status ?? classified.settlementStatus,
    arcTxHash: row.arc_tx_hash ?? classified.arcTxHash,
    arcChainId: row.arc_chain_id ?? (classified.arcTxHash ? ARC_TESTNET_CHAIN_ID : null),
    arcBlockNumber: row.arc_block_number == null ? null : String(row.arc_block_number),
    arcConfirmedAt: row.arc_confirmed_at ?? null,
    at: row.created_at,
  };
}
