/**
 * Non-LLM baseline buyers — the control group for the comparison.
 *
 * These are the naive heuristics a reasoning agent should beat:
 *  - "cheapest": buy the cheapest sources until the budget is gone.
 *  - "quality":  buy advertised-"high"-quality sources (cheapest-first) — this
 *    is the metadata-only heuristic; it can't tell the trap source apart from
 *    the genuinely useful one and wastes budget on it, and it swallows the
 *    misleading rumor because the rumor also advertises "high".
 *  - "preview": inspect every free preview, then buy only high-quality sources
 *    whose previews look company-specific and dependable. This is a stronger
 *    non-LLM control than either metadata-only baseline.
 *
 * The "brief" is just the concatenated purchased content, scored by the same
 * scoreBrief() as the agent — so the comparison is apples-to-apples.
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { catalog, getPreview } from "./marketplace.ts";
import { ensureGatewayFunded, type RunResult, type LedgerEntry, type AgentEvent } from "./agent.ts";
import { payWithinBudget } from "./paid-purchase.ts";
import { formatUsdcAtomic, usdcAtomicToNumber, usdcNumberToAtomic } from "./usdc.ts";

export type Strategy = "cheapest" | "quality" | "preview";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export interface BaselineOpts {
  strategy: Strategy;
  topic: string;
  budget: number;
  baseUrl: string;
  seed: string;
  buyerKey: `0x${string}`;
  onEvent?: (e: AgentEvent) => void;
}

export async function runBaseline(opts: BaselineOpts): Promise<RunResult> {
  const { strategy, topic, budget, baseUrl, seed, buyerKey, onEvent } = opts;
  const emit = onEvent ?? (() => {});

  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });
  await ensureGatewayFunded(gateway, budget);

  const all = catalog();
  const pick = baselinePick(strategy, all, emit);

  const budgetAtomic = usdcNumberToAtomic(budget);
  let spentAtomic = BigInt(0);
  const ledger: LedgerEntry[] = [];
  const briefParts: string[] = [];

  for (const s of pick) {
    if (usdcNumberToAtomic(s.priceUsdc) > budgetAtomic - spentAtomic) continue;
    const url = `${baseUrl}${s.purchaseUrl}?topic=${encodeURIComponent(topic)}&seed=${encodeURIComponent(seed)}`;
    const res = await payWithinBudget<{ delivered: boolean; content: string }>(
      gateway,
      url,
      budgetAtomic - spentAtomic,
    );
    spentAtomic += res.amount;
    const rationale =
      strategy === "cheapest"
        ? "cheapest available"
        : strategy === "quality"
          ? "advertised high quality"
          : "preview indicates company-specific, dependable evidence";
    const entry: LedgerEntry = {
      n: ledger.length + 1,
      sourceId: s.id,
      price: `$${formatUsdcAtomic(res.amount)}`,
      listedPrice: s.price,
      amountAtomic: res.amount.toString(),
      delivered: res.data.delivered,
      rationale,
      tx: res.transaction || undefined,
    };
    ledger.push(entry);
    emit({ kind: "purchase", ...entry });
    if (res.data.delivered) briefParts.push(res.data.content);
  }

  // The naive "brief" is just everything it bought, stitched together.
  const brief = briefParts.join("\n");

  return {
    label:
      strategy === "cheapest"
        ? "buy-cheapest"
        : strategy === "quality"
          ? "buy-by-quality"
          : "preview-aware-heuristic",
    model: "none (heuristic)",
    brief,
    factsClaimed: [],
    claims: [],
    ledger,
    spent: round(usdcAtomicToNumber(spentAtomic)),
    steps: 0,
    tokens: 0,
    previews: strategy === "preview" ? all.filter((source) => source.hasPreview).length : 0,
  };
}

function baselinePick(
  strategy: Strategy,
  sources: ReturnType<typeof catalog>,
  emit: (event: AgentEvent) => void,
) {
  if (strategy === "cheapest") {
    return [...sources].sort((a, b) => a.priceUsdc - b.priceUsdc);
  }
  if (strategy === "quality") {
    return [...sources]
      .filter((source) => source.advertisedQuality === "high")
      .sort((a, b) => a.priceUsdc - b.priceUsdc);
  }

  for (const source of sources) {
    if (source.hasPreview) emit({ kind: "preview", sourceId: source.id });
  }
  return [...sources]
    .filter((source) => {
      if (!source.hasPreview || source.advertisedQuality !== "high") return false;
      const preview = getPreview(source.id).preview?.toLowerCase() ?? "";
      return !/(sector|market-size|macro|unverified|rumor|frequently returns|no transcript)/.test(preview);
    })
    .sort((a, b) => a.priceUsdc - b.priceUsdc);
}
