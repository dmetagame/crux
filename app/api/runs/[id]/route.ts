import { NextRequest, NextResponse } from "next/server";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";
import { getRunReceiptWithStaleTimeout, runStaleTimeoutSeconds, type RunReceipt } from "@/lib/run-receipts";

export const maxDuration = 15;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const rate = await consumeRateLimit({
    key: limitKey("public:run-status", clientIp(req)),
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Run status rate limit reached. Try again shortly." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  const { id } = await ctx.params;
  const receipt = await getRunReceiptWithStaleTimeout(id);
  if (!receipt) {
    return NextResponse.json(
      { error: "Run not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(toRunStatus(receipt, req.url), {
    headers: { "Cache-Control": "no-store" },
  });
}

function toRunStatus(receipt: RunReceipt, requestUrl: string) {
  const payload = receipt.payload ?? {};
  const isComparison = payload.kind === "comparison";
  const agentDone = isComparison
    ? recordValue(recordValue(payload.results)?.["reasoning-agent"])
    : null;
  const result = isComparison ? recordValue(agentDone?.result) : recordValue(payload.result);
  const score = isComparison ? recordValue(agentDone?.score) : recordValue(payload.score);
  const events = isComparison
    ? arrayValue(payload.events)
        .map((event) => {
          const row = recordValue(event);
          return row?.label === "reasoning-agent" ? row.ev : null;
        })
        .filter(Boolean)
    : arrayValue(payload.events);

  return {
    id: receipt.id,
    status: receipt.status,
    mode: receipt.mode,
    subject: receipt.subject,
    model: receipt.model,
    budgetUsdc: receipt.budgetUsdc,
    spentUsdc: receipt.spentUsdc,
    payerKind: receipt.payerKind,
    createdAt: receipt.createdAt,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    error: receipt.error,
    receiptUrl: new URL(`/runs/${receipt.id}`, requestUrl).toString(),
    pollAfterSeconds: receipt.status === "running" ? 5 : null,
    staleAfterSeconds: receipt.status === "running" ? runStaleTimeoutSeconds() : null,
    result,
    score,
    events,
    comparison: isComparison ? recordValue(payload.results) : null,
  };
}

function recordValue(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}
