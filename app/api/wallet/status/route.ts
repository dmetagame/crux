import { NextRequest, NextResponse } from "next/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createPublicClient, formatUnits, http } from "viem";
import { getWalletKey } from "@/lib/wallet";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";
import { visitorWalletReadiness } from "@/lib/wallet-readiness";

export const maxDuration = 20;

const arcClient = createPublicClient({
  transport: http(
    process.env.ARC_TESTNET_RPC_URL ??
      process.env.NEXT_PUBLIC_ARC_RPC_URL ??
      "https://rpc.testnet.arc.network",
  ),
});

/**
 * Funding status for a user wallet. GET ?walletId=…
 * Returns wallet, Gateway, and native-gas readiness so the UI can tell the
 * visitor whether their faucet drop has landed before they start a run.
 *
 * `funded` remains the backwards-compatible run-ready flag.
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
    failureMode: "closed",
  });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: rate.failedClosed
          ? "Wallet status controls are temporarily unavailable. Try again shortly."
          : "Wallet status limit reached. Try again shortly.",
      },
      { status: rate.failedClosed ? 503 : 429, headers: rateLimitHeaders(rate) },
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
    const [bal, nativeGasResult] = await Promise.all([
      gateway.getBalances(),
      arcClient.getBalance({ address: rec.address as `0x${string}` })
        .then((value) => ({ ok: true as const, value }))
        .catch((error) => ({ ok: false as const, error })),
    ]);
    const walletUsdc = Number(bal.wallet.balance) / 1e6;
    const gatewayUsdc = Number(bal.gateway.available) / 1e6;
    const nativeGasAtomic = nativeGasResult.ok ? nativeGasResult.value : null;
    const readiness = visitorWalletReadiness({ walletUsdc, gatewayUsdc, nativeGasAtomic });
    if (!nativeGasResult.ok) {
      console.warn("[wallet] Arc native gas check failed:", (nativeGasResult.error as Error).message);
    }

    return NextResponse.json(
      {
        address: rec.address,
        walletUsdc,
        gatewayUsdc,
        nativeGasAtomic: nativeGasAtomic?.toString() ?? null,
        nativeGasBalance: nativeGasAtomic === null ? null : formatUnits(nativeGasAtomic, 18),
        gasCheckAvailable: nativeGasAtomic !== null,
        ...readiness,
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
