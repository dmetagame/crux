import { runRealResearchAgent } from "@/lib/real-agent";
import { saveRunReceipt } from "@/lib/run-receipts";
import { getWalletKey } from "@/lib/wallet";

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
  const baseUrl = url.origin;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const events: unknown[] = [];
      try {
        let buyerKey: `0x${string}` | undefined;
        if (walletId) {
          const rec = await getWalletKey(walletId);
          if (!rec) throw new Error("Unknown wallet — create one first.");
          buyerKey = rec.key;
        } else {
          buyerKey = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
          if (!buyerKey) throw new Error("Server missing BUYER_PRIVATE_KEY");
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
        let receiptId: string | null = null;
        try {
          receiptId = await saveRunReceipt({
            mode: "real",
            subject,
            model,
            budgetUsdc: budget,
            spentUsdc: result.spent,
            payerKind: walletId ? "visitor-wallet" : "house-wallet",
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
        send({ type: "error", message });
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
