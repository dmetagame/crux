import { NextRequest, NextResponse } from "next/server";
import { createUserWallet } from "@/lib/wallet";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";

export const maxDuration = 15;

/**
 * Creates an optional user-funded testnet wallet for the "pay from your own
 * wallet" lane. Body: { email? }. Returns { walletId, address }.
 *
 * The caller funds `address` themselves at faucet.circle.com (20 USDC + native
 * gas), then runs research with ?walletId=… so the payment is attributed to them.
 */
export async function POST(req: NextRequest) {
  try {
    const rate = await consumeRateLimit({
      key: limitKey("wallet:create", clientIp(req)),
      limit: 3,
      windowSeconds: 3600,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Wallet creation limit reached. Try again later." },
        { status: 429, headers: rateLimitHeaders(rate) },
      );
    }

    let email: string | null = null;
    try {
      const body = await req.json();
      const e = typeof body?.email === "string" ? body.email.trim() : "";
      // Light sanity check only — email is optional and never verified.
      if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) email = e;
    } catch {
      // No/!JSON body — anonymous wallet is fine.
    }

    const wallet = await createUserWallet(email);
    return NextResponse.json(wallet, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
