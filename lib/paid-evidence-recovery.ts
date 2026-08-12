import type { SourcedClaim } from "./claims.ts";

export interface PaidEvidenceSnapshot {
  sourceId: string;
  sourceName: string;
  content: string;
  citationUrl: string | null;
}

export interface PaidEvidenceRecoveryMetadata {
  kind: "deterministic-paid-evidence";
  reason: "provider-unavailable-after-settlement";
  degraded: true;
  noAdditionalPayments: true;
  sourceIds: string[];
}

export interface PaidEvidenceRecoveryResult {
  brief: string;
  factsClaimed: string[];
  claims: SourcedClaim[];
  recovery: PaidEvidenceRecoveryMetadata;
}

export function buildPaidEvidenceRecovery(
  subject: string,
  evidence: PaidEvidenceSnapshot[],
): PaidEvidenceRecoveryResult {
  const usable = evidence
    .filter((item) => item.sourceId.trim() && item.content.trim())
    .slice(0, 8);
  if (usable.length === 0) {
    throw new Error("Paid-evidence recovery requires at least one delivered source.");
  }

  const claims = usable.map((item) => {
    const normalized = normalize(item.content);
    const statement = evidenceStatement(normalized);
    return {
      text: truncate(`${item.sourceName} reports: ${statement}`, 500),
      sourceIds: [item.sourceId],
      evidence: truncate(normalized, 800),
    };
  });

  const brief = [
    `Recovery brief for ${subject}`,
    "The inference provider became unavailable after a source payment settled. Crux completed this limited brief only from evidence that had already been paid for and delivered. It did not restart the paid tool loop or make another source payment.",
    ...claims.map((claim) => `• ${claim.text}`),
  ].join("\n\n");

  return {
    brief,
    factsClaimed: claims.map((claim) => claim.text),
    claims,
    recovery: {
      kind: "deterministic-paid-evidence",
      reason: "provider-unavailable-after-settlement",
      degraded: true,
      noAdditionalPayments: true,
      sourceIds: usable.map((item) => item.sourceId),
    },
  };
}

function evidenceStatement(content: string) {
  const wikipedia = content.match(/^Wikipedia\s+—\s+[^:]{1,220}:\s*(.+)$/i)?.[1];
  const body = wikipedia ?? content;
  const sentence = body.match(/^(.{1,460}?[.!?])(?:\s|$)/)?.[1] ?? body;
  return truncate(sentence, 460);
}

function normalize(value: string) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
