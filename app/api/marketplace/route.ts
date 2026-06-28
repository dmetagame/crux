import { NextResponse, type NextRequest } from "next/server";
import { catalog } from "@/lib/marketplace";
import { realCatalog } from "@/lib/real-sources";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * Free marketplace catalog. Returns source metadata/previews only — never paid
 * content. `sources` is the scored benchmark catalog; `realSources` is the live
 * public-data catalog used by /api/real/{source}.
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
  return NextResponse.json({ sources: catalog(), realSources: realCatalog() });
}
