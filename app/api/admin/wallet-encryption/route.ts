import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { isMaintenanceAuthorized } from "@/lib/maintenance-auth";
import { encryptUserWalletRows } from "@/lib/wallet-backfill";
import { hasWalletEncryptionKey } from "@/lib/wallet-encryption";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isMaintenanceAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasWalletEncryptionKey()) {
    return NextResponse.json(
      { error: "CRUX_WALLET_ENCRYPTION_KEY is not configured." },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun !== false;
  const maxRows =
    typeof body?.maxRows === "number"
      ? Math.max(1, Math.min(Math.floor(body.maxRows), 1_000))
      : undefined;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const result = await encryptUserWalletRows(supabase, {
      dryRun,
      maxRows,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
