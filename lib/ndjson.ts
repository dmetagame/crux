export function ndjsonError(
  message: string,
  status = 400,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ type: "error", message }) + "\n", {
    status,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      ...headers,
    },
  });
}

export function createNdjsonWriter(
  controller: ReadableStreamDefaultController<Uint8Array>,
  opts: { heartbeatMs?: number } = {},
) {
  const encoder = new TextEncoder();
  let closed = false;
  const heartbeatMs = opts.heartbeatMs ?? 8000;

  const send = (obj: unknown) => {
    if (closed) return false;
    try {
      controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      return true;
    } catch {
      closed = true;
      return false;
    }
  };

  const heartbeat =
    heartbeatMs > 0
      ? setInterval(() => {
          send({ type: "heartbeat", at: new Date().toISOString() });
        }, heartbeatMs)
      : null;

  send({ type: "heartbeat", at: new Date().toISOString() });

  return {
    send,
    close: () => {
      if (heartbeat) clearInterval(heartbeat);
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // The client may have gone away; the route cleanup should still finish.
      }
    },
  };
}
