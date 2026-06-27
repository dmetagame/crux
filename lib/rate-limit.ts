import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/access-crypto";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number | null;
  resetAt: string | null;
  failedOpen?: boolean;
}

export interface RunLock {
  acquired: boolean;
  activeCount: number | null;
  resetAt: string | null;
  lockId: string | null;
  failedOpen?: boolean;
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    forwarded ||
    "unknown"
  );
}

export function limitKey(scope: string, identifier: string) {
  return `${scope}:${sha256Hex(identifier).slice(0, 48)}`;
}

export async function consumeRateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
  cost?: number;
}): Promise<RateLimitResult> {
  const limit = Math.max(1, Math.floor(opts.limit));
  const windowSeconds = Math.max(1, Math.floor(opts.windowSeconds));
  const cost = Math.max(1, Math.floor(opts.cost ?? 1));

  try {
    const { data, error } = await admin().rpc("consume_rate_limit", {
      p_key: opts.key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
      p_cost: cost,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: Boolean(row?.allowed),
      remaining: typeof row?.remaining === "number" ? row.remaining : null,
      resetAt: row?.reset_at ?? null,
    };
  } catch (err) {
    console.warn("[rate-limit] failing open:", (err as Error).message);
    return { allowed: true, remaining: null, resetAt: null, failedOpen: true };
  }
}

export async function acquireRunLock(opts: {
  key: string;
  limit: number;
  ttlSeconds: number;
}): Promise<RunLock> {
  try {
    const { data, error } = await admin().rpc("try_acquire_run_lock", {
      p_key: opts.key,
      p_limit: Math.max(1, Math.floor(opts.limit)),
      p_ttl_seconds: Math.max(1, Math.floor(opts.ttlSeconds)),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      acquired: Boolean(row?.acquired),
      activeCount: typeof row?.active_count === "number" ? row.active_count : null,
      resetAt: row?.reset_at ?? null,
      lockId: row?.lock_id ?? null,
    };
  } catch (err) {
    console.warn("[run-lock] failing open:", (err as Error).message);
    return {
      acquired: true,
      activeCount: null,
      resetAt: null,
      lockId: null,
      failedOpen: true,
    };
  }
}

export async function releaseRunLock(lockId: string | null) {
  if (!lockId) return;
  const { error } = await admin().rpc("release_run_lock", {
    p_lock_id: lockId,
  });
  if (error) {
    console.warn("[run-lock] release failed:", error.message);
  }
}

export function rateLimitHeaders(result: Pick<RateLimitResult, "remaining" | "resetAt">) {
  const headers: Record<string, string> = {};
  if (result.remaining !== null) headers["X-RateLimit-Remaining"] = String(result.remaining);
  if (result.resetAt) {
    headers["X-RateLimit-Reset"] = result.resetAt;
    const retryAfter = Math.max(1, Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000));
    headers["Retry-After"] = String(retryAfter);
  }
  return headers;
}

export function budgetCostUnits(usdc: number) {
  return Math.max(1, Math.ceil(usdc * 1_000_000));
}
