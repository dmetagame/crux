import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  isAdminConfigured,
  isAdminSession,
} from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      configured: isAdminConfigured(),
      authenticated: await isAdminSession(
        req.cookies.get(ADMIN_SESSION_COOKIE)?.value,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
