import { NextRequest, NextResponse } from "next/server";
import { withGateway } from "@/lib/x402";
import { SOURCES, getSourceContent } from "@/lib/marketplace";

/**
 * Paid research endpoints — one x402-protected resource per marketplace source.
 * The price is resolved per source from the catalog, so a single dynamic route
 * serves the whole marketplace. The agent pays via gateway.pay(<purchaseUrl>);
 * the response may be degraded for unreliable sources (payment still settles).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const source = SOURCES.find((s) => s.id === id);
  if (!source) {
    return NextResponse.json({ error: `Unknown source: ${id}` }, { status: 404 });
  }

  const endpoint = `/api/research/${id}`;
  const handler = async (r: NextRequest) => {
    const params = new URL(r.url).searchParams;
    const topic = params.get("topic") ?? "northwind logistics";
    const seed = params.get("seed") ?? "demo";
    return NextResponse.json(getSourceContent(id, topic, seed));
  };

  return withGateway(handler, source.price, endpoint)(req);
}
