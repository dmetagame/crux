import { NextRequest } from "next/server";
import { safeEqualHex, sha256Hex } from "@/lib/access-crypto";

export function isMaintenanceAuthorized(req: NextRequest) {
  const expected = process.env.CRUX_MAINTENANCE_TOKEN?.trim();
  if (!expected) return false;

  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-crux-maintenance-token")?.trim() ||
    "";
  if (!supplied) return false;

  return safeEqualHex(sha256Hex(supplied), sha256Hex(expected));
}
