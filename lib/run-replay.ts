import type { RunReceipt } from "@/lib/run-receipts";

export function runReceiptUrl(origin: string, receiptId: string) {
  return new URL(`/runs/${receiptId}`, origin).toString();
}

export function replayRunReceipt(receipt: RunReceipt, origin: string) {
  const receiptUrl = runReceiptUrl(origin, receipt.id);
  if (receipt.status === "completed") {
    const payload = receipt.payload ?? {};
    return {
      status: 200,
      body: {
        type: "done",
        result: payload.result ?? null,
        ...(payload.score ? { score: payload.score } : {}),
        receiptId: receipt.id,
        receiptUrl,
        replayed: true,
      },
    };
  }

  if (receipt.status === "failed") {
    return {
      status: 200,
      body: {
        type: "error",
        message: receipt.error ?? "The original run failed.",
        receiptId: receipt.id,
        receiptUrl,
        replayed: true,
      },
    };
  }

  return {
    status: 409,
    body: {
      type: "error",
      message: "A run with this Idempotency-Key is already in progress.",
      receiptId: receipt.id,
      receiptUrl,
      replayed: true,
    },
  };
}
