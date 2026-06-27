import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ARC_TESTNET_CHAIN_ID,
  classifySettlementReference,
} from "@/lib/settlement";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";

export const maxDuration = 15;

/**
 * Live traction counter. Aggregates the payment_events table that withGateway
 * writes on every Gateway settlement — total autonomous payments, total test-USDC moved,
 * average (sub-cent) transaction size, distinct payers, and the latest payments.
 * This is the RFB-01 traction metric, with Arc tx confirmation shown when
 * Circle Gateway exposes a normal EVM transaction hash.
 */
export async function GET(req: NextRequest) {
  try {
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { count } = await supabase
      .from("payment_events")
      .select("*", { count: "exact", head: true });

    const proofSelect =
      "amount_usdc, payer, endpoint, gateway_tx, settlement_reference, settlement_kind, settlement_status, arc_tx_hash, arc_chain_id, arc_block_number, arc_confirmed_at, created_at";

    const proofQuery = await supabase
      .from("payment_events")
      .select(proofSelect)
      .order("created_at", { ascending: false })
      .limit(5000);
    let rows: any[] | null = proofQuery.data;
    let error = proofQuery.error;

    if (error && isSettlementProofColumnError(error.message)) {
      const fallback = await supabase
        .from("payment_events")
        .select("amount_usdc, payer, endpoint, gateway_tx, created_at")
        .order("created_at", { ascending: false })
        .limit(5000);
      rows = fallback.data;
      error = fallback.error;
    }

    if (error) throw error;

    const all = rows ?? [];
    const total = count ?? all.length;
    const totalUsdc = all.reduce((s, r) => s + (parseFloat(r.amount_usdc) || 0), 0);
    const payerSet = new Set(all.map((r) => r.payer));
    const payers = payerSet.size;
    const avg = all.length ? totalUsdc / all.length : 0;

    const recent = all.slice(0, 8).map(normalizeRecentPayment);

    // Self-funded wallets — an honest, non-gameable traction signal: a visitor's
    // own generated wallet that ACTUALLY settled a payment (so merely clicking
    // "generate" without faucet'ing doesn't inflate the count). Best-effort: the
    // table may not exist on older deployments.
    let onboardedWallets = 0;
    try {
      const { data: wallets } = await supabase.from("user_wallets").select("address");
      const owned = new Set((wallets ?? []).map((w) => (w.address as string)?.toLowerCase()));
      const paid = new Set<string>();
      for (const addr of payerSet) {
        if (typeof addr === "string" && owned.has(addr.toLowerCase())) paid.add(addr.toLowerCase());
      }
      onboardedWallets = paid.size;
    } catch {
      // ignore — optional feature
    }

    return NextResponse.json(
      { totalPayments: total, totalUsdc, avgUsdc: avg, distinctPayers: payers, onboardedWallets, recent },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { totalPayments: 0, totalUsdc: 0, avgUsdc: 0, distinctPayers: 0, onboardedWallets: 0, recent: [], error: (err as Error).message },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

function normalizeRecentPayment(row: any) {
  const classified = classifySettlementReference(
    row.settlement_reference ?? row.gateway_tx,
  );

  return {
    amount: parseFloat(row.amount_usdc) || 0,
    endpoint: row.endpoint,
    tx: row.gateway_tx,
    settlementReference:
      row.settlement_reference ?? classified.settlementReference,
    settlementKind: row.settlement_kind ?? classified.settlementKind,
    settlementStatus: row.settlement_status ?? classified.settlementStatus,
    arcTxHash: row.arc_tx_hash ?? classified.arcTxHash,
    arcChainId:
      row.arc_chain_id ??
      (classified.arcTxHash ? ARC_TESTNET_CHAIN_ID : null),
    arcBlockNumber:
      row.arc_block_number === undefined || row.arc_block_number === null
        ? null
        : String(row.arc_block_number),
    arcConfirmedAt: row.arc_confirmed_at ?? null,
    at: row.created_at,
  };
}

function isSettlementProofColumnError(message: string) {
  return /settlement_|arc_tx_hash|arc_chain_id|arc_block_number|arc_confirmed_at/.test(
    message,
  );
}
