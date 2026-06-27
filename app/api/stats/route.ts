import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 15;

/**
 * Live traction counter. Aggregates the payment_events table that withGateway
 * writes on every settlement — total autonomous payments, total test-USDC moved,
 * average (sub-cent) transaction size, distinct payers, and the latest payments.
 * This is the RFB-01 traction metric, read straight from on-chain settlements.
 */
export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { count } = await supabase
      .from("payment_events")
      .select("*", { count: "exact", head: true });

    const { data: rows, error } = await supabase
      .from("payment_events")
      .select("amount_usdc, payer, endpoint, gateway_tx, created_at")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) throw error;

    const all = rows ?? [];
    const total = count ?? all.length;
    const totalUsdc = all.reduce((s, r) => s + (parseFloat(r.amount_usdc) || 0), 0);
    const payerSet = new Set(all.map((r) => r.payer));
    const payers = payerSet.size;
    const avg = all.length ? totalUsdc / all.length : 0;

    const recent = all.slice(0, 8).map((r) => ({
      amount: parseFloat(r.amount_usdc) || 0,
      endpoint: r.endpoint,
      tx: r.gateway_tx,
      at: r.created_at,
    }));

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
