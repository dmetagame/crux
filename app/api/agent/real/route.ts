import { runRealResearchAgent } from "@/lib/real-agent";
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
export async function GET(req: Request) {
  const url = new URL(req.url);
  const subject = url.searchParams.get("subject")?.trim() || "OpenAI";
  const model = url.searchParams.get("model") ?? "anthropic/claude-haiku-4.5";
  const budget = parseFloat(url.searchParams.get("budget") ?? "0.03");
  // Optional: pay from a visitor's own funded wallet instead of the house wallet.
  // When absent, the default zero-friction house-wallet flow is unchanged.
  const walletId = url.searchParams.get("walletId")?.trim() || null;
  const walletToken = req.headers.get("x-crux-wallet-token")?.trim() || null;
  const baseUrl = url.origin;
  const idempotencyKey = requestIdempotencyKey(req, url);
  const idempotencyScope = agentIdempotencyScope(req, "agent:real", {
    visitorWalletId: walletId,
  });

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

  const payerKind = walletId ? "visitor-wallet" : "house-wallet";
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
            model,
            budgetUsdc: budget,
            spentUsdc: result.spent,
            payerKind,
            payload: { result, events, budget, walletId: walletId ? "visitor-wallet" : null },
          });
        } catch (receiptErr) {
          console.error("[receipt] save failed:", (receiptErr as Error).message);
        }
        send({
          type: "done",
          result,
          receiptId,
          receiptUrl: receiptId ? new URL(`/runs/${receiptId}`, url.origin).toString() : null,
        });
      } catch (err) {
        let message = (err as Error).message;
        // The first run from a user wallet deposits into the Gateway, which fails
        // if the visitor hasn't faucet'd yet — turn that into a clear instruction.
        if (walletId && /insufficient|balance|deposit|funds|gas/i.test(message)) {
          message =
            "This wallet isn't funded yet. Send it 20 USDC + native gas at " +
            "faucet.circle.com (Arc testnet), wait for it to land, then run again.";
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
