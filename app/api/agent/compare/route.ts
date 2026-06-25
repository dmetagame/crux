import { runResearchAgent } from "@/lib/agent";
import { runBaseline } from "@/lib/baseline";
import { scoreBrief } from "@/lib/score";

export const maxDuration = 300;

/**
 * Streams the three-way comparison (reasoning agent vs. buy-cheapest vs.
 * buy-by-quality) on the same company/budget/seed, all paying real USDC on Arc.
 * NDJSON lines:
 *   {type:"strategy_start", label}
 *   {type:"event", label, event}              — purchases/previews as they happen
 *   {type:"strategy_done", label, result, score}
 *   {type:"done"} | {type:"error", message}
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const topic = url.searchParams.get("topic") ?? "Northwind Logistics";
  const model = url.searchParams.get("model") ?? "anthropic/claude-haiku-4.5";
  const budget = parseFloat(url.searchParams.get("budget") ?? "0.05");
  const seed = url.searchParams.get("seed") ?? "demo";
  const buyerKey = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  const baseUrl = url.origin;
  const common = { topic, budget, baseUrl, seed };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        if (!buyerKey) throw new Error("Server missing BUYER_PRIVATE_KEY");

        const runs: { label: string; run: () => Promise<import("@/lib/agent").RunResult> }[] = [
          {
            label: "reasoning-agent",
            run: () =>
              runResearchAgent({
                model,
                ...common,
                buyerKey,
                onEvent: (e) => send({ type: "event", label: "reasoning-agent", event: e }),
              }),
          },
          {
            label: "buy-cheapest",
            run: () =>
              runBaseline({
                strategy: "cheapest",
                ...common,
                buyerKey,
                onEvent: (e) => send({ type: "event", label: "buy-cheapest", event: e }),
              }),
          },
          {
            label: "buy-by-quality",
            run: () =>
              runBaseline({
                strategy: "quality",
                ...common,
                buyerKey,
                onEvent: (e) => send({ type: "event", label: "buy-by-quality", event: e }),
              }),
          },
        ];

        for (const { label, run } of runs) {
          send({ type: "strategy_start", label });
          const result = await run();
          const score = scoreBrief(result.brief, result.factsClaimed, topic);
          send({ type: "strategy_done", label, result, score });
        }
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
