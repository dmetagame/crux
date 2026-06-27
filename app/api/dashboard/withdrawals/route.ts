import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, isAdminSession } from "@/lib/admin-auth";

export const maxDuration = 15;

export async function GET(req: NextRequest) {
  if (!isAdminSession(req.cookies.get(ADMIN_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase
    .from("withdrawals")
    .select("id, created_at, amount_usdc, destination_chain, destination_address, status, tx_hash")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ withdrawals: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
