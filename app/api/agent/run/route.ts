import { runResearchAgent } from "@/lib/agent";
import { guardAgentRun } from "@/lib/agent-access";
import { createNdjsonWriter, ndjsonError, ndjsonResponse } from "@/lib/ndjson";
import { agentIdempotencyScope, requestIdempotencyKey } from "@/lib/run-idempotency";
import { replayRunReceipt, runReceiptUrl } from "@/lib/run-replay";
import {
  completeRunReceipt,
  failRunReceipt,
  getRunReceiptByIdempotencyKey,
  startRunReceipt,
} from "@/lib/run-receipts";
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
  const idempotencyKey = requestIdempotencyKey(req, url);
  const idempotencyScope = agentIdempotencyScope(req, "agent:run");

  if (idempotencyKey) {
    const existing = await getRunReceiptByIdempotencyKey(idempotencyScope, idempotencyKey);
    if (existing) {
      const replay = replayRunReceipt(existing, url.origin);
      return ndjsonResponse(replay.body, replay.status, {
        "Idempotency-Replayed": "true",
        Location: runReceiptUrl(url.origin, existing.id),
      });
    }
  }

  const guard = await guardAgentRun(req, {
    scope: "agent:run",
    budgetUsdc: budget,
    model,
    publicMaxBudgetUsdc: 0.05,
  });
  if (!guard.ok) return ndjsonError(guard.message, guard.status, guard.headers);

  let run;
  try {
    run = await startRunReceipt({
      mode: "benchmark",
      subject: topic,
      model,
      budgetUsdc: budget,
      payerKind: "house-wallet",
      idempotencyScope,
      idempotencyKey,
      payload: {
        status: "running",
        route: "agent:run",
        params: { topic, model, budget, seed },
      },
    });
  } catch (err) {
    await guard.release();
    return ndjsonError((err as Error).message, 500);
  }
  if (run.replay && run.receipt) {
    await guard.release();
    const replay = replayRunReceipt(run.receipt, url.origin);
    return ndjsonResponse(replay.body, replay.status, {
      "Idempotency-Replayed": "true",
      Location: runReceiptUrl(url.origin, run.receipt.id),
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { send, close } = createNdjsonWriter(controller);
      const events: unknown[] = [];
      let spentUsdc = 0;
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
        spentUsdc = result.spent;
        const score = scoreBrief(result.brief, result.factsClaimed, topic);
        let receiptId: string | null = null;
        try {
          receiptId = await completeRunReceipt(run.id, {
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
        const message = (err as Error).message;
        try {
          await failRunReceipt(
            run.id,
            {
              mode: "benchmark",
              subject: topic,
              model,
              budgetUsdc: budget,
              spentUsdc,
              payerKind: "house-wallet",
              payload: { status: "failed", events, seed, budget, error: message },
            },
            message,
          );
        } catch (receiptErr) {
          console.error("[receipt] fail update failed:", (receiptErr as Error).message);
        }
        send({ type: "error", message });
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
