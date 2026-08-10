import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, isAdminSession } from "@/lib/admin-auth";
import {
  ARC_TESTNET_CHAIN_ID,
  classifySettlementReference,
} from "@/lib/settlement";

export const maxDuration = 15;

export async function GET(req: NextRequest) {
  if (!(await isAdminSession(req.cookies.get(ADMIN_SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const proofSelect =
    "id, created_at, endpoint, payer, amount_usdc, amount_atomic, network, gateway_tx, settlement_reference, settlement_kind, settlement_status, arc_tx_hash, arc_chain_id, arc_block_number, arc_confirmed_at, settlement_checked_at, facilitator_requirements, facilitator_verify, facilitator_settle";

  const proofQuery = await supabase
    .from("payment_events")
    .select(proofSelect)
    .order("created_at", { ascending: false })
    .limit(1000);
  let data: any[] | null = proofQuery.data;
  let error = proofQuery.error;

  if (error && isSettlementProofColumnError(error.message)) {
    const fallback = await supabase
      .from("payment_events")
      .select("id, created_at, endpoint, payer, amount_usdc, network, gateway_tx")
      .order("created_at", { ascending: false })
      .limit(1000);
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { events: (data ?? []).map(normalizePaymentEvent) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function isSettlementProofColumnError(message: string) {
  return /amount_atomic|facilitator_|settlement_|arc_tx_hash|arc_chain_id|arc_block_number|arc_confirmed_at/.test(
    message,
  );
}

function normalizePaymentEvent(row: any) {
  const classified = classifySettlementReference(
    row.settlement_reference ?? row.gateway_tx,
  );

  return {
    ...row,
    settlement_reference:
      row.settlement_reference ?? classified.settlementReference,
    settlement_kind: row.settlement_kind ?? classified.settlementKind,
    settlement_status: row.settlement_status ?? classified.settlementStatus,
    arc_tx_hash: row.arc_tx_hash ?? classified.arcTxHash,
    arc_chain_id:
      row.arc_chain_id ??
      (classified.arcTxHash ? ARC_TESTNET_CHAIN_ID : null),
    arc_block_number:
      row.arc_block_number === undefined || row.arc_block_number === null
        ? null
        : String(row.arc_block_number),
    arc_confirmed_at: row.arc_confirmed_at ?? null,
    settlement_checked_at: row.settlement_checked_at ?? null,
  };
}
