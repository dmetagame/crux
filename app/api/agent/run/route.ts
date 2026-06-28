import { runResearchAgent } from "@/lib/agent";
import { guardAgentRun } from "@/lib/agent-access";
import { createNdjsonWriter, ndjsonError } from "@/lib/ndjson";
import { saveRunReceipt } from "@/lib/run-receipts";
import { scoreBrief } from "@/lib/score";

export const maxDuration = 60;

/**
 * Streams a single autonomous research run as NDJSON (one JSON object per line):
 *   {type:"event", event:{kind:"preview"|"purchase", ...}}   — live as it happens
 *   {type:"done", result, score}                              — final brief + score
 *   {type:"error", message}
 *
 * The agent pays REAL USDC (Arc testnet) for each purchase; purchases settle
 * through Circle Gateway and carry settlement ids for the receipt.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const topic = url.searchParams.get("topic") ?? "Northwind Logistics";
  const model = url.searchParams.get("model") ?? "anthropic/claude-haiku-4.5";
  const budget = parseFloat(url.searchParams.get("budget") ?? "0.05");
  const seed = url.searchParams.get("seed") ?? "demo";
  const buyerKey = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  const baseUrl = url.origin;

  const guard = await guardAgentRun(req, {
    scope: "agent:run",
    budgetUsdc: budget,
    model,
    publicMaxBudgetUsdc: 0.05,
  });
  if (!guard.ok) return ndjsonError(guard.message, guard.status, guard.headers);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { send, close } = createNdjsonWriter(controller);
      const events: unknown[] = [];
      try {
        if (!buyerKey) throw new Error("Server missing BUYER_PRIVATE_KEY");
        const result = await runResearchAgent({
          model,
          topic,
          budget,
          baseUrl,
          seed,
          buyerKey,
          onEvent: (e) => {
            events.push(e);
            send({ type: "event", event: e });
          },
        });
        const score = scoreBrief(result.brief, result.factsClaimed, topic);
        let receiptId: string | null = null;
        try {
          receiptId = await saveRunReceipt({
            mode: "benchmark",
            subject: topic,
            model,
            budgetUsdc: budget,
            spentUsdc: result.spent,
            payerKind: "house-wallet",
            payload: { result, score, events, seed, budget },
          });
        } catch (receiptErr) {
          console.error("[receipt] save failed:", (receiptErr as Error).message);
        }
        send({
          type: "done",
          result,
          score,
          receiptId,
          receiptUrl: receiptId ? new URL(`/runs/${receiptId}`, url.origin).toString() : null,
        });
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
