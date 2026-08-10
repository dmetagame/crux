export interface SourcedClaim {
  text: string;
  sourceIds: string[];
  evidence: string;
}

export function validateSourcedClaims(
  claims: SourcedClaim[],
  purchasedSourceIds: Set<string>,
) {
  for (const [index, claim] of claims.entries()) {
    if (!claim.text.trim()) return `Claim ${index + 1} is empty.`;
    if (!claim.evidence.trim()) return `Claim ${index + 1} is missing evidence.`;
    if (claim.sourceIds.length === 0) return `Claim ${index + 1} has no source.`;
    const unpurchased = claim.sourceIds.filter((id) => !purchasedSourceIds.has(id));
    if (unpurchased.length > 0) {
      return `Claim ${index + 1} references source(s) without delivered evidence: ${unpurchased.join(", ")}.`;
    }
  }
  return null;
}
