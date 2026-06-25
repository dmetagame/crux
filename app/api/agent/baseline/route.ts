import { runBaseline, type Strategy } from "@/lib/baseline";
import { scoreBrief } from "@/lib/score";

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
  const buyerKey = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  const baseUrl = url.origin;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        if (!buyerKey) throw new Error("Server missing BUYER_PRIVATE_KEY");
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
