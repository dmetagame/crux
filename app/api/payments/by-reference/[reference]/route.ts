import { NextRequest, NextResponse } from "next/server";
import { loadPaymentEvidence } from "@/lib/payment-evidence";
import { clientIp, consumeRateLimit, limitKey, rateLimitHeaders } from "@/lib/rate-limit";

export const maxDuration = 15;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ reference: string }> },
) {
  const rate = await consumeRateLimit({
    key: limitKey("public:payment-reference", clientIp(req)),
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Payment proof rate limit reached." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  const { reference } = await ctx.params;
  const normalized = reference.trim();
  if (!normalized || normalized.length > 512) {
    return NextResponse.json({ error: "Invalid payment reference" }, { status: 400 });
  }

  const evidence = await loadPaymentEvidence([normalized], {
    refreshGateway: true,
  });
  if (evidence.length === 0) {
    return NextResponse.json(
      { error: "Payment proof not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { payment: evidence[0] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
