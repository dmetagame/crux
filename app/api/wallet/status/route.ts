import { NextRequest, NextResponse } from "next/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { getWalletKey } from "@/lib/wallet";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";

export const maxDuration = 20;

/**
 * Funding status for a user wallet. GET ?walletId=…
 * Returns { address, walletUsdc, gatewayUsdc, funded } so the UI can tell the
 * visitor whether their faucet drop has landed before they start a run.
 *
 * `funded` is true once there is USDC to work with — either still in the wallet
 * (ready to deposit on the first run) or already deposited into the Gateway.
 */
export async function GET(req: NextRequest) {
  const walletId = new URL(req.url).searchParams.get("walletId")?.trim();
  if (!walletId) {
    return NextResponse.json({ error: "Missing walletId" }, { status: 400 });
  }
  const walletToken = req.headers.get("x-crux-wallet-token")?.trim() ?? null;

  const rate = await consumeRateLimit({
    key: limitKey("wallet:status", `${walletId}:${clientIp(req)}`),
    limit: 30,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Wallet status limit reached. Try again shortly." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  try {
    const rec = await getWalletKey(walletId, walletToken);
    if (!rec) {
      return NextResponse.json(
        { error: "Unknown or unauthorized wallet" },
        { status: 404 },
      );
    }

    const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: rec.key });
    const bal = await gateway.getBalances();
    const walletUsdc = Number(bal.wallet.balance) / 1e6;
    const gatewayUsdc = Number(bal.gateway.available) / 1e6;

    return NextResponse.json(
      {
        address: rec.address,
        walletUsdc,
        gatewayUsdc,
        funded: walletUsdc > 0 || gatewayUsdc > 0,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
