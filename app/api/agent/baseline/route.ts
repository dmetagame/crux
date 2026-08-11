import { runBaseline } from "@/lib/baseline";
import { spendAfterAgentEvent } from "@/lib/agent-event-spend";
import { baselineAgentRequest, parseAgentBody } from "@/lib/agent-request";
import { alertErrorMessage, sendOperationalAlert } from "@/lib/alerts";
import { guardAgentRun, payerKindForActor } from "@/lib/agent-access";
import { cruxCanonicalOrigin } from "@/lib/crux-origin";
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

export async function GET() {
  return ndjsonError("Agent runs require POST with an Idempotency-Key header.", 405, {
    Allow: "POST",
  });
}

export async function POST(req: Request) {
  const parsed = baselineAgentRequest.safeParse(await parseAgentBody(req));
  if (!parsed.success) return ndjsonError("Invalid baseline run request.", 400);
  const { topic, strategy, budget, seed } = parsed.data;
  const baseUrl = cruxCanonicalOrigin(req);
  const idempotencyKey = requestIdempotencyKey(req);
  if (!idempotencyKey) {
    return ndjsonError("Idempotency-Key header is required for paid agent runs.", 400);
  }
  const idempotencyScope = agentIdempotencyScope(req, "agent:baseline");

  const existing = await getRunReceiptByIdempotencyKey(idempotencyScope, idempotencyKey);
  if (existing) {
    const replay = replayRunReceipt(existing, baseUrl);
    return ndjsonResponse(replay.body, replay.status, {
      "Idempotency-Replayed": "true",
      Location: runReceiptUrl(baseUrl, existing.id),
    });
  }

  const guard = await guardAgentRun(req, {
    scope: "agent:baseline",
    budgetUsdc: budget,
    publicMaxBudgetUsdc: 0.05,
  });
  if (!guard.ok) return ndjsonError(guard.message, guard.status, guard.headers);
  const payerKind = payerKindForActor(guard.actorKind);

  let run;
  try {
    run = await startRunReceipt({
      mode: "benchmark",
      subject: topic,
      model: `baseline:${strategy}`,
      budgetUsdc: budget,
      payerKind,
      idempotencyScope,
      idempotencyKey,
      payload: {
        status: "running",
        route: "agent:baseline",
        params: { topic, strategy, budget, seed },
      },
    });
  } catch (err) {
    await guard.release();
    return ndjsonError(alertErrorMessage(err), 500);
  }

  if (run.replay && run.receipt) {
    await guard.release();
    const replay = replayRunReceipt(run.receipt, baseUrl);
    return ndjsonResponse(replay.body, replay.status, {
      "Idempotency-Replayed": "true",
      Location: runReceiptUrl(baseUrl, run.receipt.id),
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { send, close } = createNdjsonWriter(controller);
      const events: unknown[] = [];
      let spentUsdc = 0;
      try {
        const buyerKey = requireHousePrivateKey();
        const result = await runBaseline({
          strategy,
          topic,
          budget,
          baseUrl,
          seed,
          buyerKey,
          onEvent: (event) => {
            spentUsdc = spendAfterAgentEvent(spentUsdc, event);
            events.push(event);
            send({ type: "event", event });
          },
        });
        spentUsdc = result.spent;
        const score = scoreBrief(result.brief, result.factsClaimed, topic);
        const receiptId = await completeRunReceipt(run.id, {
          mode: "benchmark",
          subject: topic,
          model: `baseline:${strategy}`,
          budgetUsdc: budget,
          spentUsdc,
          payerKind,
          payload: { result, score, events, strategy, seed, budget },
        });
        send({
          type: "done",
          result,
          score,
          receiptId,
          receiptUrl: new URL(`/runs/${receiptId}`, baseUrl).toString(),
        });
      } catch (err) {
        const message = alertErrorMessage(err);
        void sendOperationalAlert({
          event: "agent_run_failed",
          severity: "warning",
          title: "Baseline agent run failed",
          summary: message,
          details: { route: "agent:baseline", topic, strategy, budget, spentUsdc },
          dedupeKey: `agent-run-failed:agent:baseline:${strategy}`,
        });
        try {
          await failRunReceipt(
            run.id,
            {
              mode: "benchmark",
              subject: topic,
              model: `baseline:${strategy}`,
              budgetUsdc: budget,
              spentUsdc,
              payerKind,
              payload: { status: "failed", events, strategy, seed, budget, error: message },
            },
            message,
          );
        } catch (receiptErr) {
          console.error("[receipt] baseline fail update failed:", alertErrorMessage(receiptErr));
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
