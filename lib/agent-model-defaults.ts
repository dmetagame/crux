export const DEFAULT_AGENT_MODEL = "openai/gpt-oss-120b";

export const DEFAULT_AGENT_MODEL_FALLBACKS = [
  "meta/llama-3.3-70b",
  "mistral/mistral-small",
  "openai/gpt-oss-20b",
] as const;

export function configuredDefaultAgentModel() {
  return process.env.CRUX_DEFAULT_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
}
