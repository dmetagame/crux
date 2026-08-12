export type AgentFailureKind =
  | "ai-capacity"
  | "wallet-funding"
  | "agent-error";

export type AgentFailureDetails = {
  kind: AgentFailureKind;
  publicMessage: string;
  paidEvidenceRetained: boolean;
};

export function agentFailureDetails(
  error: unknown,
  spentUsdc: number,
): AgentFailureDetails {
  const message = errorMessage(error);
  const paidEvidenceRetained = spentUsdc > 0;

  if (isAiProviderAvailabilityFailure(error)) {
    return {
      kind: "ai-capacity",
      paidEvidenceRetained,
      publicMessage: paidEvidenceRetained
        ? `The model provider became unavailable after ${formatUsdc(spentUsdc)} USDC settled. Crux preserved the paid source decisions and settlement evidence in this run's receipt; it did not retry and risk duplicate spend.`
        : "The configured model providers are temporarily unavailable. No source payments were made; retry shortly.",
    };
  }

  return {
    kind: "agent-error",
    publicMessage: message,
    paidEvidenceRetained,
  };
}

export function walletFundingFailure(
  spentUsdc: number,
): AgentFailureDetails {
  return {
    kind: "wallet-funding",
    paidEvidenceRetained: spentUsdc > 0,
    publicMessage:
      "This wallet isn't funded yet. Send it 20 USDC + native gas at " +
      "faucet.circle.com (Arc testnet), wait for it to land, then run again.",
  };
}

export function isVisitorWalletFundingFailure(error: unknown) {
  if (isAiProviderAvailabilityFailure(error)) return false;
  const record = recordValue(error);
  const combined = [
    record?.name,
    record?.message,
    record?.cause,
    error instanceof Error ? error.name : null,
    error instanceof Error ? error.message : error,
  ].map((value) => typeof value === "string" ? value : "").join(" ");

  return /faucet|native gas|insufficient funds for gas|insufficient.*(?:usdc|balance|funds)|gateway deposit|deposit.*(?:balance|fund|usdc)|wallet.*(?:balance|fund|usdc)|erc-?20.*balance|transfer amount exceeds balance/i.test(
    combined,
  );
}

export function isAiCapacityFailure(error: unknown) {
  const record = recordValue(error);
  const status = finiteNumber(record?.statusCode) ?? finiteNumber(record?.status);
  const combined = aiProviderErrorText(error);
  const capacitySignal =
    status === 429 ||
    /\b429\b|rate limit|too many requests|quota|credits?|capacity|free tier|billing|payment required|insufficient (?:funds|balance)/i.test(
      combined,
    );

  return hasAiProviderSignal(combined) && capacitySignal;
}

export function isAiProviderAvailabilityFailure(error: unknown) {
  const record = recordValue(error);
  if (text(record?.name) === "AgentInferenceFallbackError") return true;
  if (isAiCapacityFailure(error)) return true;

  const status = finiteNumber(record?.statusCode) ?? finiteNumber(record?.status);
  const combined = aiProviderErrorText(error);
  const availabilitySignal =
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    (status !== null && status >= 500) ||
    /timed? out|timeout|connection (?:reset|refused|failed)|fetch failed|network error|service unavailable|temporarily unavailable|no longer available|not available to new users|model (?:is )?(?:not found|unsupported|deprecated|retired)|api key|credential|unauthori[sz]ed|forbidden/i.test(
      combined,
    );

  return hasAiProviderSignal(combined) && availabilitySignal;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  const record = recordValue(error);
  return text(record?.message) ?? "The agent run failed.";
}

function aiProviderErrorText(error: unknown) {
  const record = recordValue(error);
  const cause = recordValue(record?.cause);
  return [
    text(record?.name),
    error instanceof Error ? error.name : null,
    errorMessage(error),
    text(record?.url),
    text(cause?.name),
    text(cause?.message),
  ].filter(Boolean).join(" ");
}

function hasAiProviderSignal(combined: string) {
  return /ai[_ -]?gateway|ai_apicallerror|ai_loadapikeyerror|gatewayinternalservererror|agentinferencefallbackerror|model provider|free tier|generativelanguage|google generative ai|gemini/i.test(
    combined,
  );
}

function formatUsdc(value: number) {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
