const DEFAULT_FALLBACK_MODELS = [
  "google/gemini-2.5-flash-lite",
  "openai/gpt-oss-20b",
];

type ModelStep = {
  model?: { modelId?: unknown };
  response?: { modelId?: unknown; body?: unknown };
  providerMetadata?: unknown;
};

export function agentFallbackModels(primaryModel: string) {
  const configured = process.env.CRUX_AGENT_MODEL_FALLBACKS;
  const models = configured === undefined
    ? DEFAULT_FALLBACK_MODELS
    : configured.split(/[\s,]+/);

  return [...new Set(models.map((model) => model.trim()).filter(Boolean))]
    .filter((model) => model !== primaryModel);
}

export function agentGatewayProviderOptions(primaryModel: string) {
  const models = agentFallbackModels(primaryModel);
  if (models.length === 0) return undefined;

  return {
    gateway: {
      models,
      tags: ["feature:crux-agent", "routing:model-fallback"],
    },
  };
}

export function modelsUsedFromSteps(steps: ModelStep[], requestedModel: string) {
  const models = steps
    .map((step) => actualModelFromStep(step))
    .filter((model): model is string => Boolean(model));

  return [...new Set(models.length > 0 ? models : [requestedModel])];
}

function actualModelFromStep(step: ModelStep) {
  const body = recordValue(step.response?.body);
  const bodyResponse = recordValue(body?.response);
  const gatewayMetadata = recordValue(recordValue(step.providerMetadata)?.gateway);
  const candidates = [
    bodyResponse?.modelId,
    bodyResponse?.model,
    body?.modelId,
    body?.model,
    gatewayMetadata?.modelId,
    gatewayMetadata?.model,
    step.response?.modelId,
    step.model?.modelId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
