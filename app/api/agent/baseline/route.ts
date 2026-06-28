import { runBaseline, type Strategy } from "@/lib/baseline";
import { guardAgentRun } from "@/lib/agent-access";
import { createNdjsonWriter, ndjsonError } from "@/lib/ndjson";
import { scoreBrief } from "@/lib/score";
import { requireHousePrivateKey } from "@/lib/wallet-keys";

export const maxDuration = 60;

/**
 * Streams a single non-LLM baseline run (NDJSON), so the comparison can be
 * assembled client-side from one request per strategy — each its own function
 * invocation under the 60s Hobby cap.
 *   {type:"event", event} · {type:"done", result, score} · {type:"error", message}
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const topic = url.searchParams.get("topic") ?? "Northwind Logistics";
  const strategy = (url.searchParams.get("strategy") ?? "cheapest") as Strategy;
  const budget = parseFloat(url.searchParams.get("budget") ?? "0.05");
  const seed = url.searchParams.get("seed") ?? "demo";
  const baseUrl = url.origin;

  const guard = await guardAgentRun(req, {
    scope: "agent:baseline",
    budgetUsdc: budget,
    publicMaxBudgetUsdc: 0.05,
  });
  if (!guard.ok) return ndjsonError(guard.message, guard.status, guard.headers);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { send, close } = createNdjsonWriter(controller);
      try {
        const buyerKey = requireHousePrivateKey();
        const result = await runBaseline({
          strategy,
          topic,
          budget,
          baseUrl,
          seed,
          buyerKey,
          onEvent: (e) => send({ type: "event", event: e }),
        });
        const score = scoreBrief(result.brief, result.factsClaimed, topic);
        send({ type: "done", result, score });
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        await guard.release();
        close();
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
