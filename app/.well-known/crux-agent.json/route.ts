import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const publicHouseWalletRunsEnabled = envBool(
    "CRUX_PUBLIC_AGENT_RUNS_ENABLED",
    true,
  );

  return NextResponse.json({
    name: "Crux",
    description:
      "Payment-native research data and autonomous research runners over x402 on Arc Testnet.",
    homepage: `${origin}/agent`,
    developerDocs: `${origin}/agents`,
    openapi: `${origin}/openapi.json`,
    integrationGuide: "https://github.com/dmetagame/crux/blob/main/AGENT_INTEGRATION.md",
    demoRunbook: "https://github.com/dmetagame/crux/blob/main/DEMO.md",
    marketplace: `${origin}/api/marketplace`,
    publicStats: `${origin}/api/stats`,
    runStatus: `${origin}/api/runs/{id}`,
    capabilities: [
      "x402-paid live data resources",
      "visitor-funded research runs",
      "trusted-agent house-wallet research runs",
      "operator/admin demo workspace",
      "durable run receipts",
    ],
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
        auth: "x402 payment",
        note: "Preferred integration path. External agents pay Crux directly and need no Crux API key.",
      },
      {
        type: "visitor-wallet-runner",
        endpoints: ["/api/wallet/create", "/api/wallet/status", "/api/agent/real"],
        auth: "walletId plus X-Crux-Wallet-Token header",
        note: "Use this when the calling user/agent should pay from its own Arc testnet wallet.",
      },
      {
        type: "house-wallet-runner",
        endpoints: ["/api/agent/real", "/api/agent/run", "/api/agent/baseline"],
        auth: "Authorization: Bearer <Crux agent key> or an operator admin session",
        publicAccessEnabled: publicHouseWalletRunsEnabled,
        note: publicHouseWalletRunsEnabled
          ? "Demo/orchestration surface. Public access is capped; production agents should request a scoped Crux agent key."
          : "Public house-wallet access is disabled in production. Trusted agents need a scoped Crux agent API key.",
      },
    ],
    auth: {
      x402PaidResources: "x402 payment",
      trustedAgentRunners: "Authorization: Bearer <Crux agent key>",
      operatorRunners: "signed admin session cookie",
      publicHouseWalletRunners: publicHouseWalletRunsEnabled ? "capped public demo access" : "disabled",
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

function envBool(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}
