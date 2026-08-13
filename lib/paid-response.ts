export interface NormalizedPaidResponse {
  delivered: boolean;
  content: string;
  citationUrl: string | null;
}

export function normalizePaidResponse(value: unknown): NormalizedPaidResponse {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const content = typeof record?.content === "string" ? record.content : "";
  const citationUrl = typeof record?.citationUrl === "string" && record.citationUrl.trim()
    ? record.citationUrl.trim()
    : null;

  return {
    delivered: record?.delivered === true && content.trim().length > 0,
    content,
    citationUrl,
  };
}
