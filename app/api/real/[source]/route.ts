import { NextRequest, NextResponse } from "next/server";
import { withGateway } from "@/lib/x402";
import { REAL_SOURCES, fetchRealSource } from "@/lib/real-sources";

/**
 * Paid REAL-data endpoints — one x402-protected resource per real source. Price
 * is resolved per source from the catalog, so one dynamic route serves them all.
 * The agent pays via gateway.pay(<purchaseUrl>?subject=...); the handler then
 * fetches live public data (Wikipedia/Wikidata/EDGAR/Hacker News). A miss
 * returns delivered:false — payment still settles, exactly like a real paid API.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const { source } = await ctx.params;
  const meta = REAL_SOURCES.find((s) => s.id === source);
  if (!meta) {
    return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 404 });
  }

  const endpoint = `/api/real/${source}`;
  const handler = async (r: NextRequest) => {
    const subject = new URL(r.url).searchParams.get("subject") ?? "";
    if (!subject.trim()) {
      return NextResponse.json({ delivered: false, content: "No subject supplied.", citationUrl: null });
    }
    return NextResponse.json(await fetchRealSource(source, subject));
  };

  return withGateway(handler, meta.price, endpoint)(req);
}
