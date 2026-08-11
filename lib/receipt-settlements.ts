export function settlementReferencesFromPayload(payload: unknown) {
  const references = new Set<string>();
  const seen = new Set<object>();

  visit(payload, 0, seen, references);
  return [...references];
}

function visit(
  value: unknown,
  depth: number,
  seen: Set<object>,
  references: Set<string>,
) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) visit(item, depth + 1, seen, references);
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      ["tx", "gatewayTx", "gateway_tx", "settlementReference", "settlement_reference"].includes(key) &&
      typeof child === "string" &&
      child.trim() &&
      child.length <= 512
    ) {
      references.add(child.trim());
    }
    visit(child, depth + 1, seen, references);
  }
}
