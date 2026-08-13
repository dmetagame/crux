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

  const requestedModel = req.nextUrl.searchParams.get("model")?.trim();
  if (requestedModel && !/^gemini-[a-z0-9][a-z0-9._-]*$/i.test(requestedModel)) {
    return NextResponse.json(
      { ok: false, route: "direct-gemini", error: "Invalid Gemini model ID." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const model = requestedModel
    || process.env.CRUX_DIRECT_GEMINI_MODEL?.trim()
    || "gemini-3.1-flash-lite";
  if (req.nextUrl.searchParams.get("catalog") === "1") {
    return googleModelCatalog(apiKey);
  }
  if (req.nextUrl.searchParams.get("mode") === "agent") {
    return agentToolLoopHealth(apiKey, model);
  }
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
      toolChoice: { type: "tool", toolName: "health_ready" },
      stopWhen: [() => toolCalled, stepCountIs(2)],
      maxOutputTokens: 64,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(25_000),
    });
    if (!toolCalled) {
      return NextResponse.json(
        {
          ok: false,
          route: "direct-gemini",
          model,
          error: "Model did not execute the required tool call.",
          finishReason: result.finishReason,
          toolCalls: result.toolCalls.length,
          textReturned: Boolean(result.text.trim()),
          steps: result.steps.length,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
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

async function agentToolLoopHealth(apiKey: string, model: string) {
  let catalogCalled = false;
  let completed = false;
  try {
    const google = createGoogleGenerativeAI({ apiKey });
    const result = await generateText({
      model: google(model),
      system:
        "You are a tool-using health agent. Use the tools exactly as instructed and do not answer with plain text.",
      prompt:
        "First call inspect_catalog. After reading its result, call complete_check with the best source and a short rationale.",
      tools: {
        inspect_catalog: tool({
          description: "Returns a mock paid-source catalog without spending money.",
          inputSchema: z.object({}),
          execute: async () => {
            catalogCalled = true;
            return {
              sources: [
                { id: "wikipedia", priceUsdc: 0.002, fit: "broad company background" },
                { id: "edgar", priceUsdc: 0.01, fit: "U.S. public-company filings" },
              ],
            };
          },
        }),
        complete_check: tool({
          description: "Completes the dry-run source decision after catalog inspection.",
          inputSchema: z.object({
            sourceId: z.string().min(1),
            rationale: z.string().min(1),
          }),
          execute: async ({ sourceId, rationale }) => {
            if (!catalogCalled) return { ok: false, error: "Inspect the catalog first." };
            completed = true;
            return { ok: true, sourceId, rationale };
          },
        }),
      },
      stopWhen: [() => completed, stepCountIs(4)],
      maxOutputTokens: 128,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(25_000),
    });
    if (!catalogCalled || !completed) {
      return NextResponse.json(
        {
          ok: false,
          route: "direct-gemini",
          mode: "agent",
          model,
          error: "Model did not complete the required autonomous tool sequence.",
          catalogCalled,
          completed,
          finishReason: result.finishReason,
          toolCalls: result.toolCalls.length,
          steps: result.steps.length,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        route: "direct-gemini",
        mode: "agent",
        model,
        steps: result.steps.length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, route: "direct-gemini", mode: "agent", model, error: alertErrorMessage(error) },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

async function googleModelCatalog(apiKey: string) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(20_000), cache: "no-store" },
    );
    const body = await response.json() as {
      error?: { message?: string };
      models?: Array<{
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    if (!response.ok) {
      throw new Error(body.error?.message || `Google model catalog returned HTTP ${response.status}.`);
    }
    const models = (body.models ?? [])
      .filter((item) => item.supportedGenerationMethods?.includes("generateContent"))
      .map((item) => ({
        id: item.name?.replace(/^models\//, "") || "",
        displayName: item.displayName || "",
      }))
      .filter((item) => item.id.startsWith("gemini-"));
    return NextResponse.json(
      { ok: true, route: "direct-gemini", models },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, route: "direct-gemini", error: alertErrorMessage(error) },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
