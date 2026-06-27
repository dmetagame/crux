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
