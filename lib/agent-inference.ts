import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { isAiProviderAvailabilityFailure } from "./agent-failure.ts";
import {
  agentGatewayProviderOptions,
  modelsUsedFromSteps,
} from "./agent-models.ts";

export type AgentInferenceRoute = "ai-gateway" | "direct-gemini";

type ModelStep = Parameters<typeof modelsUsedFromSteps>[0][number];

export interface AgentInferenceAttempt {
  model: LanguageModel;
  route: AgentInferenceRoute;
  reportedModel: string;
  providerOptions?: ReturnType<typeof agentGatewayProviderOptions>;
}

export interface AgentInferenceResult<T> {
  value: T;
  attempt: AgentInferenceAttempt;
  fallbackFrom?: string;
}

interface RunAgentInferenceOptions<T> {
  primaryModel: string;
  preferredRoute?: AgentInferenceRoute;
  purchaseAttempted: () => boolean;
  run: (attempt: AgentInferenceAttempt) => Promise<T>;
  resetBeforeFallback?: () => void;
}

const DEFAULT_DIRECT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const DIRECT_GEMINI_PREFIX = "google-direct/";

export async function runAgentInferenceWithFallback<T>(
  options: RunAgentInferenceOptions<T>,
): Promise<AgentInferenceResult<T>> {
  const gateway: AgentInferenceAttempt = {
    model: options.primaryModel,
    route: "ai-gateway",
    reportedModel: options.primaryModel,
    providerOptions: agentGatewayProviderOptions(options.primaryModel),
  };
  const directPrimary = options.preferredRoute === "direct-gemini"
    ? directGeminiAttempt()
    : null;
  const primary = directPrimary ?? gateway;

  try {
    return { value: await options.run(primary), attempt: primary };
  } catch (primaryError) {
    const fallback = primary.route === "direct-gemini"
      ? gateway
      : directGeminiAttempt();
    if (
      options.purchaseAttempted()
      || !fallback
      || !isAiProviderAvailabilityFailure(primaryError)
    ) {
      throw primaryError;
    }

    options.resetBeforeFallback?.();
    try {
      return {
        value: await options.run(fallback),
        attempt: fallback,
        fallbackFrom: primary.reportedModel,
      };
    } catch (fallbackError) {
      if (options.purchaseAttempted()) throw fallbackError;
      if (isAiProviderAvailabilityFailure(fallbackError)) {
        throw combinedFallbackError(fallbackError);
      }
      throw fallbackError;
    }
  }
}

export function shouldUseDirectGeminiFallback(
  error: unknown,
  purchaseAttempted: boolean,
) {
  return !purchaseAttempted && hasDirectGeminiFallback() && isAiProviderAvailabilityFailure(error);
}

export function hasDirectGeminiFallback() {
  return directGeminiFallbackEnabled() && Boolean(directGeminiApiKey());
}

export function configuredDirectGeminiReceiptModel() {
  if (!hasDirectGeminiFallback()) return null;
  return directGeminiReceiptModel(directGeminiModelId());
}

export function visitorPreferredInferenceRoute(): AgentInferenceRoute {
  if (!hasDirectGeminiFallback()) return "ai-gateway";
  const value = process.env.CRUX_VISITOR_DIRECT_GEMINI_PRIMARY_ENABLED
    ?.trim()
    .toLowerCase();
  return value === "true" || value === "1" || value === "yes"
    ? "direct-gemini"
    : "ai-gateway";
}

export function modelsUsedForInference(
  steps: ModelStep[],
  attempt: AgentInferenceAttempt,
) {
  const models = modelsUsedFromSteps(steps, attempt.reportedModel);
  if (attempt.route !== "direct-gemini") return models;
  return [...new Set(models.map(directGeminiReceiptModel))];
}

function directGeminiAttempt(): AgentInferenceAttempt | null {
  const apiKey = directGeminiApiKey();
  if (!directGeminiFallbackEnabled() || !apiKey) return null;

  const modelId = directGeminiModelId();
  const google = createGoogleGenerativeAI({ apiKey });
  return {
    model: google(modelId),
    route: "direct-gemini",
    reportedModel: directGeminiReceiptModel(modelId),
  };
}

function directGeminiApiKey() {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
    || process.env.GEMINI_API_KEY?.trim()
    || null;
}

function directGeminiFallbackEnabled() {
  const value = process.env.CRUX_DIRECT_GEMINI_FALLBACK_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function directGeminiModelId() {
  const model = process.env.CRUX_DIRECT_GEMINI_MODEL?.trim() || DEFAULT_DIRECT_GEMINI_MODEL;
  if (!/^gemini-[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new Error("CRUX_DIRECT_GEMINI_MODEL must be a Gemini model ID.");
  }
  return model;
}

function directGeminiReceiptModel(model: string) {
  const normalized = model
    .replace(/^google-direct\//, "")
    .replace(/^google\//, "");
  return `${DIRECT_GEMINI_PREFIX}${normalized}`;
}

function combinedFallbackError(fallbackError: unknown) {
  const detail = fallbackError instanceof Error && fallbackError.message.trim()
    ? fallbackError.message.trim()
    : String(fallbackError);
  const error = new Error(
    `Both configured inference routes failed before any source payment: ${detail}`,
    { cause: fallbackError },
  );
  error.name = "AgentInferenceFallbackError";
  return error;
}
