import { runRealResearchAgent } from "@/lib/real-agent";

export const maxDuration = 60;

/**
 * Streams a single REAL-subject research run as NDJSON (one JSON object per line):
 *   {type:"event", event:{kind:"preview"|"purchase", ...}}   — live as it happens
 *   {type:"done", result}                                    — final brief + citations
 *   {type:"error", message}
 *
 * Pays REAL USDC (Arc testnet) for each live data source. No scorer — the subject
 * is real, so the brief is judged by its citations rather than a ground-truth key.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const subject = url.searchParams.get("subject")?.trim() || "OpenAI";
  const model = url.searchParams.get("model") ?? "anthropic/claude-haiku-4.5";
  const budget = parseFloat(url.searchParams.get("budget") ?? "0.03");
  const buyerKey = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  const baseUrl = url.origin;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        if (!buyerKey) throw new Error("Server missing BUYER_PRIVATE_KEY");
        const result = await runRealResearchAgent({
          model,
          subject,
          budget,
          baseUrl,
          buyerKey,
          onEvent: (e) => send({ type: "event", event: e }),
        });
        send({ type: "done", result });
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
