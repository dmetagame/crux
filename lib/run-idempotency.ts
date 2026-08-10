import { sha256Hex } from "@/lib/access-crypto";
import { clientIp } from "@/lib/rate-limit";

export function requestIdempotencyKey(req: Request) {
  const value =
    req.headers.get("idempotency-key") ??
    req.headers.get("x-idempotency-key");
  const key = value?.trim();
  if (!key) return null;
  return key.slice(0, 200);
}

export function agentIdempotencyScope(
  req: Request,
  scope: string,
  opts: { visitorWalletId?: string | null } = {},
) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    return `${scope}:api:${sha256Hex(bearer).slice(0, 32)}`;
  }
  if (opts.visitorWalletId) {
    return `${scope}:visitor:${sha256Hex(opts.visitorWalletId).slice(0, 32)}`;
  }
  return `${scope}:public:${sha256Hex(clientIp(req)).slice(0, 32)}`;
}
