import { saveRunReceipt } from "@/lib/run-receipts";

export const maxDuration = 15;

type ComparisonBody = {
  topic?: string;
  budget?: number;
  seed?: string;
  results?: Record<string, unknown>;
  events?: unknown[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ComparisonBody;
    const topic = typeof body.topic === "string" && body.topic.trim()
      ? body.topic.trim()
      : "Northwind Logistics";
    const budget = typeof body.budget === "number" && Number.isFinite(body.budget)
      ? body.budget
      : 0.05;
    const results = body.results && typeof body.results === "object" ? body.results : null;

    if (!results) {
      return Response.json({ error: "results are required" }, { status: 400 });
    }

    const rows = Object.values(results)
      .map((value) => value as { result?: { spent?: number; model?: string } })
      .filter((value) => value.result);
    const spent = rows.reduce((sum, row) => sum + (Number(row.result?.spent) || 0), 0);
    const agent = results["reasoning-agent"] as { result?: { model?: string } } | undefined;

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
        seed: body.seed ?? "demo",
        results,
        events: Array.isArray(body.events) ? body.events : [],
      },
    });

    return Response.json({
      receiptId,
      receiptUrl: new URL(`/runs/${receiptId}`, req.url).toString(),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
