import { NextResponse, type NextRequest } from "next/server";
import { runStaleTimeoutSeconds } from "@/lib/run-receipts";
import { configuredDefaultAgentModel } from "@/lib/agent-model-defaults";

type OpenApiRunnerTool = {
  post: {
    summary: string;
    security: Record<string, never[]>[];
    parameters: Record<string, unknown>[];
    requestBody: Record<string, unknown>;
    responses: Record<string, unknown>;
    "x-crux": Record<string, unknown>;
  };
};

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const staleTimeoutSeconds = runStaleTimeoutSeconds();
  const publicHouseWalletRunsEnabled = envBool(
    "CRUX_PUBLIC_AGENT_RUNS_ENABLED",
    false,
  );

  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Crux Agent API",
      version: "1.0.0",
      description:
        "Payment-native research data and demo agent runners. x402-paid resources are the primary external-agent surface.",
    },
    externalDocs: {
      description: "Live Crux agent integration guide",
      url: `${origin}/agents`,
    },
    servers: [{ url: origin }],
    security: [],
    paths: {
      "/api/marketplace": {
        get: {
          summary: "List benchmark and real-source marketplace metadata",
          responses: { "200": { description: "Marketplace catalog" } },
          "x-rateLimit": "120 requests/minute/IP",
        },
      },
      "/api/stats": {
        get: {
          summary: "Read public payment traction and settlement proof metadata",
          responses: { "200": { description: "Live Crux stats" } },
          "x-rateLimit": "60 requests/minute/IP",
        },
      },
      "/api/version": {
        get: {
          summary: "Read the deployed Crux git SHA and environment",
          responses: { "200": { description: "Deployment version metadata" } },
        },
      },
      "/api/wallet/create": {
        post: {
          summary: "Create a fresh stored visitor wallet",
          description:
            "Creates a fresh Arc testnet wallet and returns a short-lived capability token. Store the token client-side and send it back as X-Crux-Wallet-Token.",
          responses: {
            "200": { description: "walletId, address, and walletToken" },
            "429": { description: "Wallet creation rate limit reached" },
          },
          "x-rateLimit": "3 requests/hour/IP",
          "x-crux": {
            network: "arcTestnet",
            fundAt: "https://faucet.circle.com",
            note: "Visitor wallets are Crux-hosted custodial testnet wallets. Crux does not sponsor these runs.",
          },
        },
      },
      "/api/wallet/status": {
        get: {
          summary: "Check a visitor wallet's Arc testnet funding status",
          security: [{ CruxWalletToken: [] }],
          parameters: [
            { name: "walletId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": { description: "address, walletUsdc, gatewayUsdc, and funded" },
            "404": { description: "Unknown or unauthorized wallet" },
            "429": { description: "Wallet status rate limit reached" },
          },
          "x-rateLimit": "30 requests/minute/wallet/IP",
        },
      },
      "/api/runs/{id}": {
        get: {
          summary: "Read durable agent run status/result",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": { description: "Run status, receipt URL, and result/error when available" },
            "404": { description: "Run not found" },
            "429": { description: "Run status rate limit reached" },
          },
          "x-rateLimit": "120 requests/minute/IP",
          "x-crux": {
            states: ["running", "completed", "failed"],
            pollAfterSeconds: 5,
            staleTimeoutSeconds,
          },
        },
      },
      "/api/payments/by-reference/{reference}": {
        get: {
          summary: "Read sanitized proof for one x402 settlement reference",
          parameters: [
            { name: "reference", in: "path", required: true, schema: { type: "string", maxLength: 512 } },
          ],
          responses: {
            "200": { description: "Sanitized facilitator evidence, Circle's UUID-to-batch mapping, and decoded Arc batch id and payer/seller deltas when confirmed" },
            "404": { description: "Payment proof not found" },
          },
          "x-rateLimit": "120 requests/minute/IP",
        },
      },
      "/api/real/{source}": {
        get: {
          summary: "Buy a live public-data source for a real subject",
          parameters: [
            { name: "source", in: "path", required: true, schema: { type: "string" } },
            { name: "subject", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Purchased source result" },
            "402": { description: "x402 payment required" },
          },
          "x-x402": {
            required: true,
            network: "arcTestnet",
            settlement: "circle_gateway_batched",
            discovery: "Call /api/marketplace and use realSources[].id and realSources[].price.",
          },
        },
      },
      "/api/research/{id}": {
        get: {
          summary: "Buy a benchmark research source",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "topic", in: "query", required: false, schema: { type: "string" } },
            { name: "seed", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Purchased source content" },
            "402": { description: "x402 payment required" },
          },
          "x-x402": {
            required: true,
            network: "arcTestnet",
            settlement: "circle_gateway_batched",
            discovery: "Call /api/marketplace and use sources[].id and sources[].price.",
          },
        },
      },
      "/api/premium/quote": paidTool("GET", "$0.001", "Buy a premium quote"),
      "/api/premium/dataset": paidTool("GET", "$0.01", "Buy a small premium dataset"),
      "/api/premium/compute": paidTool("POST", "$0.0003", "Buy a text compute result"),
      "/api/premium/agent-task": paidTool("GET", "$0.03", "Buy one premium agent-task clue"),
      "/api/agent/real": realRunnerTool(publicHouseWalletRunsEnabled),
      "/api/agent/run": runnerTool(
        "agent:run",
        "Run Crux's benchmark research agent",
        publicHouseWalletRunsEnabled,
      ),
      "/api/agent/baseline": runnerTool(
        "agent:baseline",
        "Run a benchmark baseline strategy",
        publicHouseWalletRunsEnabled,
      ),
    },
    components: {
      securitySchemes: {
        CruxAgentKey: {
          type: "http",
          scheme: "bearer",
          description:
            "Optional scoped key for higher-limit house-wallet runner access. x402-paid resources do not use this key.",
        },
        CruxWalletToken: {
          type: "apiKey",
          in: "header",
          name: "X-Crux-Wallet-Token",
          description:
            "Visitor-wallet secret returned by /api/wallet/create. Required with walletId for visitor-funded runs and wallet status checks.",
        },
        CruxAdminSession: {
          type: "apiKey",
          in: "cookie",
          name: "crux_admin_session",
          description:
            "Signed operator/admin session cookie from /admin/login. Used by the web workspace for embedded house-wallet runs.",
        },
      },
    },
  });
}

function paidTool(method: "GET" | "POST", price: string, summary: string) {
  return {
    [method.toLowerCase()]: {
      summary,
      responses: {
        "200": { description: "Purchased result" },
        "402": { description: "x402 payment required" },
      },
      "x-x402": {
        required: true,
        network: "arcTestnet",
        price,
        settlement: "circle_gateway_batched",
      },
    },
  };
}

function realRunnerTool(publicHouseWalletRunsEnabled: boolean) {
  const tool = runnerTool(
    "agent:real",
    "Run Crux's real-subject research agent",
    publicHouseWalletRunsEnabled,
  );
  tool.post.security = [
    { CruxAgentKey: [] },
    { CruxAdminSession: [] },
    { CruxWalletToken: [] },
  ];
  tool.post.requestBody = jsonRequestBody({
    subject: { type: "string", description: "Company, project, person, or topic to research." },
    model: { type: "string", default: configuredDefaultAgentModel() },
    budget: { type: "number", default: 0.03, maximum: 1 },
    walletId: {
      type: ["string", "null"],
      format: "uuid",
      description: "With X-Crux-Wallet-Token, pays from the visitor wallet instead of the house wallet.",
    },
  }, ["subject"]);
  tool.post["x-crux"].visitorWalletSupported = true;
  return tool;
}

function runnerTool(
  scope: string,
  summary: string,
  publicHouseWalletRunsEnabled: boolean,
): OpenApiRunnerTool {
  return {
    post: {
      summary,
      security: [{ CruxAgentKey: [] }, { CruxAdminSession: [] }],
      parameters: [
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", maxLength: 200 },
          description:
            "Required. Reusing the same key for the same caller returns the existing running/completed/failed run instead of spending again.",
        },
      ],
      requestBody:
        scope === "agent:baseline"
          ? jsonRequestBody({
              topic: { type: "string", default: "Northwind Logistics" },
              strategy: { type: "string", enum: ["cheapest", "quality", "preview"], default: "cheapest" },
              budget: { type: "number", default: 0.05, maximum: 1 },
              seed: { type: "string", default: "demo" },
            })
          : jsonRequestBody({
              topic: { type: "string", default: "Northwind Logistics" },
              model: { type: "string", default: configuredDefaultAgentModel() },
              budget: { type: "number", default: 0.05, maximum: 1 },
              seed: { type: "string", default: "demo" },
            }),
      responses: {
        "200": { description: "NDJSON stream of events and final result" },
        "409": { description: "A run with this Idempotency-Key is already in progress" },
        "401": {
          description: publicHouseWalletRunsEnabled
            ? "Invalid or disabled API key when supplied"
            : "Public house-wallet runs are disabled; use a Crux agent key, admin session, or visitor wallet.",
        },
        "429": { description: "Rate, budget, or concurrency cap reached" },
      },
      "x-crux": {
        scope,
        contentType: "application/x-ndjson",
        failureReceipt:
          "If a provider fails after payment, the terminal error includes receiptId, receiptUrl, and paidEvidenceRetained. Crux does not automatically retry paid runs.",
        publicHouseWalletRunsEnabled,
        idempotency:
          "Required on every paid runner request. If a replay returns running/409, poll /api/runs/{receiptId}.",
        authModes: publicHouseWalletRunsEnabled
          ? ["public-capped", "crux-agent-key", "admin-session"]
          : ["crux-agent-key", "admin-session"],
        note: publicHouseWalletRunsEnabled
          ? "Public demo access is tightly capped because this route can spend the house wallet."
          : "Public house-wallet access is disabled in production because this route can spend the house wallet.",
      },
    },
  };
}

function jsonRequestBody(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          additionalProperties: false,
          properties,
          ...(required.length ? { required } : {}),
        },
      },
    },
  };
}

function envBool(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}
