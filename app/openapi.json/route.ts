import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;

  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Crux Agent API",
      version: "1.0.0",
      description:
        "Payment-native research data and demo agent runners. x402-paid resources are the primary external-agent surface.",
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
      "/api/agent/real": runnerTool("agent:real", "Run Crux's real-subject research agent"),
      "/api/agent/run": runnerTool("agent:run", "Run Crux's benchmark research agent"),
      "/api/agent/baseline": runnerTool("agent:baseline", "Run a benchmark baseline strategy"),
    },
    components: {
      securitySchemes: {
        CruxAgentKey: {
          type: "http",
          scheme: "bearer",
          description:
            "Optional scoped key for higher-limit house-wallet runner access. x402-paid resources do not use this key.",
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

function runnerTool(scope: string, summary: string) {
  return {
    get: {
      summary,
      security: [{ CruxAgentKey: [] }],
      parameters: [
        {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: { type: "string", maxLength: 200 },
          description:
            "Recommended for retries. Reusing the same key for the same caller returns the existing running/completed/failed run instead of spending again.",
        },
      ],
      responses: {
        "200": { description: "NDJSON stream of events and final result" },
        "409": { description: "A run with this Idempotency-Key is already in progress" },
        "401": { description: "Invalid or disabled API key when supplied" },
        "429": { description: "Rate, budget, or concurrency cap reached" },
      },
      "x-crux": {
        scope,
        contentType: "application/x-ndjson",
        publicDemoAccess: true,
        idempotency:
          "Send Idempotency-Key on retried agent-run requests to avoid duplicate spend.",
        note: "Public demo access is tightly capped because this route can spend the house wallet.",
      },
    },
  };
}
