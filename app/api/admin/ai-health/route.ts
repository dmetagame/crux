import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, stepCountIs, tool } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { alertErrorMessage } from "@/lib/alerts";
import { isMaintenanceAuthorized } from "@/lib/maintenance-auth";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!isMaintenanceAuthorized(req)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
    || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, route: "direct-gemini", error: "Direct Gemini key is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const model = process.env.CRUX_DIRECT_GEMINI_MODEL?.trim() || "gemini-3.5-flash";
  let toolCalled = false;
  try {
    const google = createGoogleGenerativeAI({ apiKey });
    const result = await generateText({
      model: google(model),
      prompt: "Call health_ready exactly once, then reply READY.",
      tools: {
        health_ready: tool({
          description: "Confirms that the direct Gemini tool route is operational.",
          inputSchema: z.object({}),
          execute: async () => {
            toolCalled = true;
            return { ready: true };
          },
        }),
      },
      stopWhen: stepCountIs(2),
      maxOutputTokens: 64,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(25_000),
    });
    if (!toolCalled) throw new Error("Model did not execute the required tool call.");
    return NextResponse.json(
      { ok: true, route: "direct-gemini", model, steps: result.steps.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, route: "direct-gemini", model, error: alertErrorMessage(error) },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
