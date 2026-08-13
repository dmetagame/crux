import { evidenceMatchesSubject } from "./subject-relevance.ts";

export function publicRealRunResult(subject: string, value: unknown) {
  const result = recordValue(value);
  if (!result) return value ?? null;

  const recovery = recordValue(result.recovery);
  if (recovery?.kind !== "deterministic-paid-evidence") return result;

  const claims = arrayValue(result.claims)
    .map(recordValue)
    .filter((claim): claim is Record<string, unknown> => claim !== null);
  const relevantClaims = claims.filter((claim) => {
    const evidence = textValue(claim.evidence);
    return evidence ? evidenceMatchesSubject(subject, evidence) : false;
  });
  const explicitlyRejected = recovery.relevantEvidenceFound === false;
  const legacyMismatch = recovery.relevantEvidenceFound === undefined
    && claims.length > 0
    && relevantClaims.length === 0;
  if (!explicitlyRejected && !legacyMismatch) return result;

  return {
    ...result,
    brief: [
      `Recovery brief for ${subject}`,
      "A post-run relevance audit found that no delivered source matched the literal subject. Crux therefore makes no factual claim from this run.",
      "The immutable payment ledger and settlement references remain visible as proof of what was paid before the mismatch was detected.",
    ].join("\n\n"),
    factsClaimed: [],
    claims: [],
    citations: [],
    outcome: "degraded-recovery",
    recovery: {
      ...recovery,
      relevantEvidenceFound: false,
      providerFailureKind: textValue(recovery.providerFailureKind) ?? "unknown",
      sourceIds: [],
    },
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
