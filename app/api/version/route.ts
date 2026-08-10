import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    {
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL ?? null,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
