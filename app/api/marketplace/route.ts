import { NextResponse, type NextRequest } from "next/server";
import { catalog } from "@/lib/marketplace";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * Free marketplace catalog. Returns source metadata and free previews only —
 * never paid content. This is the surface the agent's `list_marketplace` and
 * `preview` tools read before deciding what to pay for.
 */
export async function GET(req: NextRequest) {
  const rate = await consumeRateLimit({
    key: limitKey("public:marketplace", clientIp(req)),
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Marketplace rate limit reached." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }
  return NextResponse.json({ sources: catalog() });
}
