import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;

  return NextResponse.json({
    name: "Crux",
    description:
      "Payment-native research data and autonomous research demos over x402 on Arc Testnet.",
    homepage: `${origin}/agent`,
    openapi: `${origin}/openapi.json`,
    marketplace: `${origin}/api/marketplace`,
    publicStats: `${origin}/api/stats`,
    runStatus: `${origin}/api/runs/{id}`,
    x402: {
      supported: true,
      network: "arcTestnet",
      settlement: "circle_gateway_batched",
      proof:
        "Crux labels Gateway settlement references separately from Arc tx hashes and links ArcScan only for real EVM transaction hashes.",
    },
    recommendedExternalAgentSurface: [
      {
        type: "x402-paid-resource",
        endpoints: ["/api/real/{source}", "/api/research/{id}", "/api/premium/*"],
        note: "Preferred integration path. External agents pay Crux directly.",
      },
      {
        type: "house-wallet-runner",
        endpoints: ["/api/agent/real", "/api/agent/run", "/api/agent/baseline"],
        note: "Demo/orchestration surface. Public access is capped; higher limits require a scoped Crux agent API key.",
      },
    ],
    auth: {
      x402PaidResources: "x402 payment",
      houseWalletRunners: "public capped demo access or Authorization: Bearer <Crux agent key>",
      visitorWallets: "walletId plus X-Crux-Wallet-Token header",
    },
    idempotency: {
      header: "Idempotency-Key",
      appliesTo: ["/api/agent/real", "/api/agent/run"],
      behavior:
        "Retries with the same key and caller receive the existing running/completed/failed run instead of spending again. Poll /api/runs/{id} while a run is still running.",
    },
  });
}
