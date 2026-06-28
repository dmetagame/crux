import { runResearchAgent } from "@/lib/agent";
import { alertErrorMessage, sendOperationalAlert } from "@/lib/alerts";
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
import { requireHousePrivateKey } from "@/lib/wallet-keys";

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
    const message = alertErrorMessage(err);
    void sendOperationalAlert({
      event: "agent_receipt_start_failed",
      severity: "critical",
      title: "Benchmark run receipt start failed",
      summary: message,
      details: {
        route: "agent:run",
        topic,
        model,
        budget,
      },
      dedupeKey: `agent-receipt-start-failed:agent:run:${model}`,
    });
    await guard.release();
    return ndjsonError(message, 500);
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
        const buyerKey = requireHousePrivateKey();
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
          void sendOperationalAlert({
            event: "agent_receipt_save_failed",
            severity: "critical",
            title: "Benchmark run receipt save failed",
            summary: alertErrorMessage(receiptErr),
            details: {
              route: "agent:run",
              runId: run.id,
              topic,
              model,
              budget,
              spentUsdc: result.spent,
            },
            dedupeKey: `agent-receipt-save-failed:agent:run:${model}`,
          });
        }
        send({
          type: "done",
          result,
          score,
          receiptId,
          receiptUrl: receiptId ? new URL(`/runs/${receiptId}`, url.origin).toString() : null,
        });
      } catch (err) {
        const message = alertErrorMessage(err);
        void sendOperationalAlert({
          event: "agent_run_failed",
          severity: "warning",
          title: "Benchmark agent run failed",
          summary: message,
          details: {
            route: "agent:run",
            runId: run.id,
            topic,
            model,
            budget,
            spentUsdc,
          },
          dedupeKey: `agent-run-failed:agent:run:${model}`,
        });
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
          void sendOperationalAlert({
            event: "agent_receipt_fail_update_failed",
            severity: "critical",
            title: "Benchmark run receipt fail update failed",
            summary: alertErrorMessage(receiptErr),
            details: {
              route: "agent:run",
              runId: run.id,
              topic,
              model,
              budget,
            },
            dedupeKey: `agent-receipt-fail-update-failed:agent:run:${model}`,
          });
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
