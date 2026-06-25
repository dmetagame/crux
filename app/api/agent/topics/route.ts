import { NextResponse } from "next/server";
import { listTopics } from "@/lib/marketplace";

/** Companies the agent can research (for the web UI's picker). */
export async function GET() {
  return NextResponse.json({ topics: listTopics() });
}
