import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { safeEqualHex, sha256Hex } from "@/lib/access-crypto";
import { encryptUserWalletRows } from "@/lib/wallet-backfill";
import { hasWalletEncryptionKey } from "@/lib/wallet-encryption";

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
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

function isAuthorized(req: NextRequest) {
  const expected = process.env.CRUX_MAINTENANCE_TOKEN?.trim();
  if (!expected) return false;

  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-crux-maintenance-token")?.trim() ||
    "";
  if (!supplied) return false;

  return safeEqualHex(sha256Hex(supplied), sha256Hex(expected));
}
