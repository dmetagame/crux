import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  isAdminSession,
  isSameOriginAdminMutation,
} from "@/lib/admin-auth";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";
import { saveRunReceipt } from "@/lib/run-receipts";

export const maxDuration = 15;

type ComparisonBody = {
  topic?: string;
  budget?: number;
  seed?: string;
  results?: Record<string, unknown>;
  events?: unknown[];
};

const COMPARISON_KEYS = ["reasoning-agent", "buy-cheapest", "buy-by-quality"] as const;
const MAX_BODY_CHARS = 250_000;
const MAX_EVENTS = 120;

export async function POST(req: NextRequest) {
  if (!(await isAdminSession(req.cookies.get(ADMIN_SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSameOriginAdminMutation(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const rate = await consumeRateLimit({
    key: limitKey("agent:compare-receipt", clientIp(req)),
    limit: 20,
    windowSeconds: 60 * 60,
    failureMode: "closed",
  });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: rate.failedClosed
          ? "Comparison receipt controls are temporarily unavailable. Try again shortly."
          : "Comparison receipt limit reached. Try again later.",
      },
      { status: rate.failedClosed ? 503 : 429, headers: rateLimitHeaders(rate) },
    );
  }

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: "Comparison receipt payload is too large." }, { status: 413 });
    }

    const body = JSON.parse(raw || "{}") as ComparisonBody;
    const topic = typeof body.topic === "string" && body.topic.trim()
      ? body.topic.trim().slice(0, 160)
      : "Northwind Logistics";
    const budget = typeof body.budget === "number" && Number.isFinite(body.budget)
      ? body.budget
      : 0.05;
    const results = cleanComparisonResults(body.results);

    if (!results) {
      return NextResponse.json(
        { error: "results must include reasoning-agent, buy-cheapest, and buy-by-quality outputs." },
        { status: 400 },
      );
    }

    const rows = Object.values(results)
      .map((value) => value as { result?: { spent?: number; model?: string } })
      .filter((value) => value.result);
    const spent = rows.reduce((sum, row) => sum + (Number(row.result?.spent) || 0), 0);
    const agent = results["reasoning-agent"] as { result?: { model?: string } } | undefined;
    const events = cleanComparisonEvents(body.events);

    const receiptId = await saveRunReceipt({
      mode: "benchmark",
      subject: topic,
      model: agent?.result?.model ?? "comparison",
      budgetUsdc: budget,
      spentUsdc: spent,
      payerKind: "house-wallet",
      payload: {
        kind: "comparison",
        topic,
        budget,
        seed: typeof body.seed === "string" ? body.seed.slice(0, 80) : "demo",
        results,
        events,
      },
    });

    return NextResponse.json({
      receiptId,
      receiptUrl: new URL(`/runs/${receiptId}`, req.url).toString(),
    });
  } catch (err) {
    const message = err instanceof SyntaxError ? "Invalid JSON body." : (err as Error).message;
    return NextResponse.json({ error: message }, { status: err instanceof SyntaxError ? 400 : 500 });
  }
}

function cleanComparisonResults(value: unknown): Record<string, unknown> | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const cleaned: Record<string, unknown> = {};
  for (const key of COMPARISON_KEYS) {
    const done = asRecord(raw[key]);
    const result = asRecord(done?.result);
    const score = asRecord(done?.score);
    if (!done || !result || !score) return null;

    const spent = Number(result.spent);
    if (!Number.isFinite(spent) || spent < 0 || spent > 1) return null;

    cleaned[key] = done;
  }
  return cleaned;
}

function cleanComparisonEvents(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const label = typeof row?.label === "string" ? row.label : "";
      const ev = asRecord(row?.ev);
      if (!COMPARISON_KEYS.includes(label as (typeof COMPARISON_KEYS)[number]) || !ev) return null;
      return { label, ev };
    })
    .filter(Boolean)
    .slice(0, MAX_EVENTS);
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}
