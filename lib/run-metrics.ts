export type MetricsRunRow = {
  status?: string | null;
  budget_usdc?: string | number | null;
  spent_usdc?: string | number | null;
  payer_kind?: string | null;
  payload?: Record<string, unknown> | null;
};

const MICRO_USDC = BigInt(1_000_000);

export function aggregateRunMetrics(rows: MetricsRunRow[]) {
  let completed = 0;
  let recovered = 0;
  let spent = BigInt(0);
  let budget = BigInt(0);
  const actorCategories = { house: 0, visitor: 0, trustedAgent: 0 };
  for (const row of rows) {
    if (row.status && row.status !== "completed") continue;
    if (row.payload?.kind === "comparison") continue;
    if (isDegradedRecovery(row.payload)) {
      recovered += 1;
      continue;
    }
    completed += 1;
    spent += decimalToAtomic(row.spent_usdc);
    budget += decimalToAtomic(row.budget_usdc);
    const kind = String(row.payer_kind ?? "house-wallet");
    if (kind === "visitor-wallet") actorCategories.visitor += 1;
    else if (kind === "trusted-agent") actorCategories.trustedAgent += 1;
    else actorCategories.house += 1;
  }
  return { completed, recovered, spent, budget, actorCategories };
}

function isDegradedRecovery(payload: Record<string, unknown> | null | undefined) {
  const result = recordValue(payload?.result);
  const recovery = recordValue(result?.recovery);
  return recovery?.degraded === true;
}

function decimalToAtomic(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return BigInt(0);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * MICRO_USDC + BigInt((fraction + "000000").slice(0, 6));
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
