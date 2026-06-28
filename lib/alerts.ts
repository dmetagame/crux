type AlertSeverity = "warning" | "critical";

type AlertPayload = {
  event: string;
  severity: AlertSeverity;
  title: string;
  summary: string;
  details?: Record<string, unknown>;
  dedupeKey?: string;
  dedupeMs?: number;
};

const DEFAULT_DEDUPE_MS = 5 * 60 * 1000;
const sentAtByKey = new Map<string, number>();

export async function sendOperationalAlert(payload: AlertPayload) {
  const webhookUrls = alertWebhookUrls();
  if (webhookUrls.length === 0) return;

  const dedupeKey = payload.dedupeKey ?? `${payload.event}:${payload.summary}`;
  const now = Date.now();
  const lastSentAt = sentAtByKey.get(dedupeKey) ?? 0;
  if (now - lastSentAt < (payload.dedupeMs ?? DEFAULT_DEDUPE_MS)) return;
  sentAtByKey.set(dedupeKey, now);

  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const body = {
    text: `[Crux ${payload.severity}] ${payload.title}`,
    content: `[Crux ${payload.severity}] ${payload.title}`,
    event: payload.event,
    severity: payload.severity,
    environment: env,
    summary: redact(payload.summary),
    details: sanitizeDetails(payload.details ?? {}),
    timestamp: new Date().toISOString(),
  };

  await Promise.all(webhookUrls.map((webhookUrl) => postAlert(webhookUrl, body)));
}

export function alertErrorMessage(err: unknown) {
  return redact(err instanceof Error ? err.message : String(err));
}

function alertWebhookUrls() {
  return (process.env.CRUX_ALERT_WEBHOOK_URL ?? "")
    .split(/[\s,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
}

async function postAlert(webhookUrl: string, body: Record<string, unknown>) {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "crux-alerts/1.0",
    };
    const token = process.env.CRUX_ALERT_WEBHOOK_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      console.warn("[alert] webhook failed:", res.status, await safeText(res));
    }
  } catch (err) {
    console.warn("[alert] webhook error:", (err as Error).message);
  }
}

function sanitizeDetails(details: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === "string" ? redact(value) : value,
    ]),
  );
}

function redact(value: string) {
  return value
    .replace(/0x[a-fA-F0-9]{64}/g, "0x[redacted-private-key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "[redacted-token]")
    .slice(0, 1000);
}

async function safeText(res: Response) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
