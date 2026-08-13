import { REAL_SOURCES } from "./real-sources.ts";
import { usdcNumberToAtomic } from "./usdc.ts";

export const MAX_REAL_RESEARCH_PURCHASES = 2;
const OVERLAPPING_IDENTITY_SOURCES = new Set(["wikipedia", "wikidata"]);

export interface ProposedRealPurchase {
  sourceId: string;
  rationale: string;
}

export interface RealPurchasePlanItem extends ProposedRealPurchase {
  amountAtomic: bigint;
}

export function normalizeRealPurchasePlan(
  proposed: ProposedRealPurchase[],
  budgetAtomic: bigint,
): RealPurchasePlanItem[] {
  const catalog = new Map(REAL_SOURCES.map((source) => [source.id, source]));
  const seen = new Set<string>();
  let identitySourceAccepted = false;
  const accepted: RealPurchasePlanItem[] = [];
  let remaining = budgetAtomic;

  for (const item of proposed) {
    const source = catalog.get(item.sourceId);
    const rationale = item.rationale.trim();
    if (!source || !rationale || seen.has(source.id)) continue;
    if (OVERLAPPING_IDENTITY_SOURCES.has(source.id) && identitySourceAccepted) continue;
    const amountAtomic = usdcNumberToAtomic(source.priceUsdc);
    if (amountAtomic > remaining) continue;

    seen.add(source.id);
    if (OVERLAPPING_IDENTITY_SOURCES.has(source.id)) identitySourceAccepted = true;
    accepted.push({ sourceId: source.id, rationale, amountAtomic });
    remaining -= amountAtomic;
    if (accepted.length >= MAX_REAL_RESEARCH_PURCHASES) break;
  }

  return accepted;
}
