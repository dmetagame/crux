import { NextRequest, NextResponse } from "next/server";
import { createUserWallet } from "@/lib/wallet";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";

export const maxDuration = 15;

/**
 * Creates an optional user-funded testnet wallet for the "pay from your own
 * wallet" lane. Always creates a fresh capability-protected wallet.
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
      failureMode: "closed",
    });
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: rate.failedClosed
            ? "Wallet creation controls are temporarily unavailable. Try again shortly."
            : "Wallet creation limit reached. Try again later.",
        },
        { status: rate.failedClosed ? 503 : 429, headers: rateLimitHeaders(rate) },
      );
    }

    const wallet = await createUserWallet();
    return NextResponse.json(wallet, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
