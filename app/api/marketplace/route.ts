import { NextResponse } from "next/server";
import { catalog } from "@/lib/marketplace";

/**
 * Free marketplace catalog. Returns source metadata and free previews only —
 * never paid content. This is the surface the agent's `list_marketplace` and
 * `preview` tools read before deciding what to pay for.
 */
export async function GET() {
  return NextResponse.json({ sources: catalog() });
}
