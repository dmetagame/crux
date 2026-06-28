import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendOperationalAlert } from "@/lib/alerts";
import { isMaintenanceAuthorized } from "@/lib/maintenance-auth";

export async function POST(req: NextRequest) {
  if (!isMaintenanceAuthorized(req)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const label =
    typeof body?.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 120)
      : "manual test";
  const requestedAt = new Date().toISOString();
  const deliveries = await sendOperationalAlert({
    event: "alert_test",
    severity: "warning",
    title: "Crux alert test",
    summary: `Manual alert test: ${label}`,
    details: {
      route: "/api/admin/alerts/test",
      requestedAt,
    },
    dedupeKey: `alert-test:${randomUUID()}`,
    dedupeMs: 0,
  });

  if (deliveries.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRUX_ALERT_WEBHOOK_URL is not configured.",
        deliveries,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const ok = deliveries.every((delivery) => delivery.ok);
  return NextResponse.json(
    {
      ok,
      destinations: deliveries.length,
      deliveries,
      requestedAt,
    },
    {
      status: ok ? 200 : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
