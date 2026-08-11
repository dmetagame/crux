import { runRealResearchAgent } from "@/lib/real-agent";
import { spendAfterAgentEvent } from "@/lib/agent-event-spend";
import { parseAgentBody, realAgentRequest } from "@/lib/agent-request";
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
import { getWalletKey } from "@/lib/wallet";
import { requireHousePrivateKey } from "@/lib/wallet-keys";

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
export async function GET() {
  return ndjsonError("Agent runs require POST with an Idempotency-Key header.", 405, {
    Allow: "POST",
  });
}

export async function POST(req: Request) {
  const parsed = realAgentRequest.safeParse(await parseAgentBody(req));
  if (!parsed.success) return ndjsonError("Invalid real-subject run request.", 400);
  const { subject, model, budget, walletId } = parsed.data;
  const walletToken = req.headers.get("x-crux-wallet-token")?.trim() || null;
  const baseUrl = cruxCanonicalOrigin(req);
  const idempotencyKey = requestIdempotencyKey(req);
  if (!idempotencyKey) {
    return ndjsonError("Idempotency-Key header is required for paid agent runs.", 400);
  }
  const idempotencyScope = agentIdempotencyScope(req, "agent:real", {
    visitorWalletId: walletId,
  });

  const existing = await getRunReceiptByIdempotencyKey(idempotencyScope, idempotencyKey);
  if (existing) {
    const replay = replayRunReceipt(existing, baseUrl);
    return ndjsonResponse(replay.body, replay.status, {
      "Idempotency-Replayed": "true",
      Location: runReceiptUrl(baseUrl, existing.id),
    });
  }

  let visitorWallet: { key: `0x${string}`; address: string } | null = null;
  if (walletId) {
    visitorWallet = await getWalletKey(walletId, walletToken);
    if (!visitorWallet) {
      return ndjsonError("Unknown or unauthorized wallet.", 404);
    }
  }

  const guard = await guardAgentRun(req, {
    scope: "agent:real",
    budgetUsdc: budget,
    model,
    visitorWalletId: walletId,
    publicMaxBudgetUsdc: 0.03,
  });
  if (!guard.ok) return ndjsonError(guard.message, guard.status, guard.headers);

  const payerKind = payerKindForActor(guard.actorKind);
  let run;
  try {
    run = await startRunReceipt({
      mode: "real",
      subject,
      model,
      budgetUsdc: budget,
      payerKind,
      idempotencyScope,
      idempotencyKey,
      payload: {
        status: "running",
        route: "agent:real",
        params: {
          subject,
          model,
          budget,
          wallet: walletId ? "visitor-wallet" : "house-wallet",
        },
      },
    });
  } catch (err) {
    const message = alertErrorMessage(err);
    void sendOperationalAlert({
      event: "agent_receipt_start_failed",
      severity: "critical",
      title: "Real run receipt start failed",
      summary: message,
      details: {
        route: "agent:real",
        subject,
        model,
        budget,
        payerKind,
      },
      dedupeKey: `agent-receipt-start-failed:agent:real:${payerKind}:${model}`,
    });
    await guard.release();
    return ndjsonError(message, 500);
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
        let buyerKey: `0x${string}` | undefined;
        if (walletId) {
          buyerKey = visitorWallet?.key;
          if (!buyerKey) throw new Error("Unknown or unauthorized wallet.");
        } else {
          buyerKey = requireHousePrivateKey();
        }
        const result = await runRealResearchAgent({
          model,
          subject,
          budget,
          baseUrl,
          buyerKey,
          onEvent: (e) => {
            spentUsdc = spendAfterAgentEvent(spentUsdc, e);
            events.push(e);
            send({ type: "event", event: e });
          },
        });
        spentUsdc = result.spent;
        let receiptId: string | null = null;
        try {
          receiptId = await completeRunReceipt(run.id, {
            mode: "real",
            subject,
            model: result.model,
            budgetUsdc: budget,
            spentUsdc: result.spent,
            payerKind,
            payload: { result, events, budget, walletId: walletId ? "visitor-wallet" : null },
          });
        } catch (receiptErr) {
          console.error("[receipt] save failed:", (receiptErr as Error).message);
          void sendOperationalAlert({
            event: "agent_receipt_save_failed",
            severity: "critical",
            title: "Real run receipt save failed",
            summary: alertErrorMessage(receiptErr),
            details: {
              route: "agent:real",
              runId: run.id,
              subject,
              model,
              budget,
              spentUsdc: result.spent,
              payerKind,
            },
            dedupeKey: `agent-receipt-save-failed:agent:real:${payerKind}:${model}`,
          });
        }
        send({
          type: "done",
          result,
          receiptId,
          receiptUrl: receiptId ? new URL(`/runs/${receiptId}`, baseUrl).toString() : null,
        });
      } catch (err) {
        let message = alertErrorMessage(err);
        let expectedFundingIssue = false;
        // The first run from a user wallet deposits into the Gateway, which fails
        // if the visitor hasn't faucet'd yet — turn that into a clear instruction.
        if (walletId && /insufficient|balance|deposit|funds|gas/i.test(message)) {
          expectedFundingIssue = true;
          message =
            "This wallet isn't funded yet. Send it 20 USDC + native gas at " +
            "faucet.circle.com (Arc testnet), wait for it to land, then run again.";
        }
        if (!expectedFundingIssue) {
          void sendOperationalAlert({
            event: "agent_run_failed",
            severity: "warning",
            title: "Real agent run failed",
            summary: message,
            details: {
              route: "agent:real",
              runId: run.id,
              subject,
              model,
              budget,
              spentUsdc,
              payerKind,
            },
            dedupeKey: `agent-run-failed:agent:real:${payerKind}:${model}`,
          });
        }
        try {
          await failRunReceipt(
            run.id,
            {
              mode: "real",
              subject,
              model,
              budgetUsdc: budget,
              spentUsdc,
              payerKind,
              payload: {
                status: "failed",
                events,
                budget,
                walletId: walletId ? "visitor-wallet" : null,
                error: message,
              },
            },
            message,
          );
        } catch (receiptErr) {
          console.error("[receipt] fail update failed:", (receiptErr as Error).message);
          void sendOperationalAlert({
            event: "agent_receipt_fail_update_failed",
            severity: "critical",
            title: "Real run receipt fail update failed",
            summary: alertErrorMessage(receiptErr),
            details: {
              route: "agent:real",
              runId: run.id,
              subject,
              model,
              budget,
              payerKind,
            },
            dedupeKey: `agent-receipt-fail-update-failed:agent:real:${payerKind}:${model}`,
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
