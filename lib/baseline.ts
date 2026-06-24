/**
 * Non-LLM baseline buyers — the control group for the comparison.
 *
 * These are the naive heuristics a reasoning agent should beat:
 *  - "cheapest": buy the cheapest sources until the budget is gone.
 *  - "quality":  buy advertised-"high"-quality sources (cheapest-first) — this
 *    is the metadata-only heuristic; it can't tell the trap source apart from
 *    the genuinely useful one and wastes budget on it, and it swallows the
 *    misleading rumor because the rumor also advertises "high".
 *
 * The "brief" is just the concatenated purchased content, scored by the same
 * scoreBrief() as the agent — so the comparison is apples-to-apples.
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { catalog } from "./marketplace.ts";
import { ensureGatewayFunded, type RunResult, type LedgerEntry } from "./agent.ts";

export type Strategy = "cheapest" | "quality";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export interface BaselineOpts {
  strategy: Strategy;
  topic: string;
  budget: number;
  baseUrl: string;
  seed: string;
  buyerKey: `0x${string}`;
  onEvent?: (msg: string) => void;
}

export async function runBaseline(opts: BaselineOpts): Promise<RunResult> {
  const { strategy, topic, budget, baseUrl, seed, buyerKey, onEvent } = opts;
  const log = onEvent ?? (() => {});

  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });
  await ensureGatewayFunded(gateway, budget);

  const all = catalog();
  const pick =
    strategy === "cheapest"
      ? [...all].sort((a, b) => a.priceUsdc - b.priceUsdc)
      : [...all].filter((s) => s.advertisedQuality === "high").sort((a, b) => a.priceUsdc - b.priceUsdc);

  let spent = 0;
  const ledger: LedgerEntry[] = [];
  const briefParts: string[] = [];

  for (const s of pick) {
    if (spent + s.priceUsdc > budget + 1e-9) continue; // can't afford; try the next (cheaper-first list)
    const url = `${baseUrl}${s.purchaseUrl}?topic=${encodeURIComponent(topic)}&seed=${encodeURIComponent(seed)}`;
    const res = await gateway.pay(url, { method: "GET" });
    const data = res.data as { delivered: boolean; content: string };
    spent += s.priceUsdc;
    ledger.push({
      n: ledger.length + 1,
      sourceId: s.id,
      price: s.price,
      delivered: data.delivered,
      rationale: strategy === "cheapest" ? "cheapest available" : "advertised high quality",
    });
    log(`  $ paid ${s.price} for ${s.id} ${data.delivered ? "" : "(DEGRADED) "}[${strategy}]`);
    if (data.delivered) briefParts.push(data.content);
  }

  // The naive "brief" is just everything it bought, stitched together.
  const brief = briefParts.join("\n");

  return {
    label: strategy === "cheapest" ? "buy-cheapest" : "buy-by-quality",
    model: "none (heuristic)",
    brief,
    factsClaimed: [],
    ledger,
    spent: round(spent),
    steps: 0,
    tokens: 0,
    previews: 0,
  };
}
