import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { safeEqualHex, sha256Hex } from "@/lib/access-crypto";
import { alertErrorMessage, sendOperationalAlert } from "@/lib/alerts";
import { isMaintenanceAuthorized } from "@/lib/maintenance-auth";
import {
  paymentReconciliationAlertSummary,
  reconcilePayments,
} from "@/lib/payment-reconciliation";
import {
  clientIp,
  consumeRateLimit,
  limitKey,
  rateLimitHeaders,
} from "@/lib/rate-limit";

export const maxDuration = 60;

const VERCEL_CRON_SCHEDULE = "0 3 * * *";

export async function GET(req: NextRequest) {
  const authMode = authorizeReconciliation(req);
  if (!authMode) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (authMode === "vercel-cron") {
    const rate = await consumeRateLimit({
      key: limitKey("admin:reconcile-payments", clientIp(req)),
      limit: 4,
      windowSeconds: 60 * 60,
      failureMode: "closed",
    });
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: rate.failedClosed
            ? "Reconciliation usage controls are temporarily unavailable."
            : "Too many reconciliation requests.",
        },
        {
          status: rate.failedClosed ? 503 : 429,
          headers: {
            ...rateLimitHeaders(rate),
            "Cache-Control": "no-store",
          },
        },
      );
    }
  }

  const url = new URL(req.url);
  const limit = readNumber(url.searchParams.get("limit"));
  const staleHours = readNumber(url.searchParams.get("staleHours"));
  const dryRun = url.searchParams.get("dryRun") === "true";
  const alertEnabled = url.searchParams.get("alert") !== "false";
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    const summary = await reconcilePayments(supabase, {
      limit,
      staleHours,
      dryRun,
    });

    if (alertEnabled && summary.issueCount > 0) {
      void sendOperationalAlert({
        event: "payment_reconciliation_issues",
        severity: summary.criticalCount > 0 ? "critical" : "warning",
        title: "Payment reconciliation found issues",
        summary: paymentReconciliationAlertSummary(summary),
        details: {
          authMode,
          dryRun,
          scanned: summary.scanned,
          updated: summary.updated,
          issueCount: summary.issueCount,
          criticalCount: summary.criticalCount,
          warningCount: summary.warningCount,
          issueCodes: summary.issueCodes,
          sampleEvents: summary.issues.slice(0, 5).map((issue) => ({
            eventId: issue.eventId,
            code: issue.code,
            severity: issue.severity,
            endpoint: issue.endpoint,
          })),
        },
        dedupeKey: `payment-reconciliation:${Object.keys(summary.issueCodes).sort().join(",")}`,
        dedupeMs: 30 * 60 * 1000,
      });
    }

    return NextResponse.json(
      {
        ...summary,
        authMode,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = alertErrorMessage(err);
    void sendOperationalAlert({
      event: "payment_reconciliation_failed",
      severity: "critical",
      title: "Payment reconciliation failed",
      summary: message,
      details: {
        authMode,
        dryRun,
      },
      dedupeKey: "payment-reconciliation-failed",
      dedupeMs: 10 * 60 * 1000,
    });

    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function authorizeReconciliation(req: NextRequest) {
  if (isMaintenanceAuthorized(req)) return "maintenance";
  if (isCronSecretAuthorized(req)) return "cron-secret";
  if (isVercelCron(req)) return "vercel-cron";
  return null;
}

function isCronSecretAuthorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-crux-cron-secret")?.trim() ||
    "";
  if (!supplied) return false;
  return safeEqualHex(sha256Hex(supplied), sha256Hex(expected));
}

function isVercelCron(req: NextRequest) {
  const userAgent = req.headers.get("user-agent") ?? "";
  const schedule = req.headers.get("x-vercel-cron-schedule") ?? "";
  return (
    userAgent.includes("vercel-cron/1.0") &&
    schedule === VERCEL_CRON_SCHEDULE
  );
}

function readNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
