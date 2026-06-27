import { NextResponse, type NextRequest } from "next/server";
import { listTopics } from "@/lib/marketplace";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";

/** Companies the agent can research (for the web UI's picker). */
export async function GET(req: NextRequest) {
  const rate = await consumeRateLimit({
    key: limitKey("public:agent-topics", clientIp(req)),
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Topics rate limit reached." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }
  return NextResponse.json({ topics: listTopics() });
}
