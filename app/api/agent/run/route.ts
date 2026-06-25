import { runResearchAgent } from "@/lib/agent";
import { scoreBrief } from "@/lib/score";

export const maxDuration = 300;

/**
 * Streams a single autonomous research run as NDJSON (one JSON object per line):
 *   {type:"event", event:{kind:"preview"|"purchase", ...}}   — live as it happens
 *   {type:"done", result, score}                              — final brief + score
 *   {type:"error", message}
 *
 * The agent pays REAL USDC (Arc testnet) for each purchase; purchases settle and
 * carry an on-chain tx the UI links to the explorer.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const topic = url.searchParams.get("topic") ?? "Northwind Logistics";
  const model = url.searchParams.get("model") ?? "anthropic/claude-haiku-4.5";
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
        const result = await runResearchAgent({
          model,
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
