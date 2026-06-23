/**
 * Objective scorer for a due-diligence brief on the demo topic.
 *
 * This is what makes the baseline comparison meaningful: it grades a brief by
 * how many weighted ground-truth facts it captured, and flags whether it
 * ingested the marketplace's misleading rumor as fact. The smart agent should
 * score high coverage for low spend with no false claim; naive baselines should
 * either miss facts (buy-cheapest) or include the false claim (buy-all).
 *
 * Fact detection is intentionally separate from the source content — the
 * delivered content carries no answer-key tags, so matching here is the only
 * place the content→fact mapping lives.
 */
import { GROUND_TRUTH } from "./marketplace.ts";

const MATCHERS: Record<string, (t: string) => boolean> = {
  // F1 — revenue ~40% YoY to $2.1B
  F1: (t) => /\b2\.1\s*(billion|bn|b)\b/.test(t) || /\b40(\.\d+)?\s*%/.test(t),
  // F2 — CEO departed abruptly in Q2 (no successor)
  F2: (t) =>
    /\b(ceo|chief executive)\b/.test(t) &&
    /(depart|resign|left|step(?:ped)? down|no (?:permanent )?successor|leadership (?:change|turnover|transition)|succession)/.test(
      t,
    ),
  // F3 — SEC investigation into revenue recognition
  F3: (t) =>
    /\b(sec|enforcement|investigation|inquiry|formal order)\b/.test(t) &&
    /(revenue[- ]recognition|recognition (?:timing|practices)|timing of (?:certain )?revenue)/.test(
      t,
    ),
  // F4 — strong balance sheet: ~$180M cash, low leverage
  F4: (t) =>
    /\b180\s*(m|million)\b/.test(t) ||
    /(low|minimal|little)\s+(debt|leverage)/.test(t) ||
    /strong (?:balance sheet|financial position)/.test(t),
  // F5 — customer concentration: top client ~35% of revenue
  F5: (t) =>
    /\b35\s*%/.test(t) ||
    /(customer|client) concentration/.test(t) ||
    /(largest|top|single) (?:customer|client)/.test(t),
};

// The rumor source claims an imminent acquisition (FALSE). A brief that asserts
// it without skeptical framing has ingested misinformation as fact.
function assertsFalseAcquisition(t: string): boolean {
  const mentions = /(acquisition|acquired|buyout|takeover|merger|being bought)/.test(t);
  if (!mentions) return false;
  const skeptical =
    /(rumor|rumour|unverified|unconfirmed|not confirmed|no (?:such )?deal|false|denied|speculation|disregard|discount|unsubstantiated)/.test(
      t,
    );
  return !skeptical;
}

export interface BriefScore {
  capturedFacts: { id: string; weight: number; fact: string }[];
  missedFacts: { id: string; weight: number; fact: string }[];
  weighted: number;
  maxWeighted: number;
  coverage: number; // 0..1
  falseClaim: boolean;
}

const MAX_WEIGHTED = GROUND_TRUTH.reduce((s, f) => s + f.weight, 0);

export function scoreBrief(brief: string, factsClaimed: string[] = []): BriefScore {
  const t = `${brief}\n${factsClaimed.join("\n")}`.toLowerCase();

  const captured: BriefScore["capturedFacts"] = [];
  const missed: BriefScore["missedFacts"] = [];
  for (const f of GROUND_TRUTH) {
    const hit = MATCHERS[f.id]?.(t) ?? false;
    (hit ? captured : missed).push({ id: f.id, weight: f.weight, fact: f.fact });
  }

  const weighted = captured.reduce((s, f) => s + f.weight, 0);
  return {
    capturedFacts: captured,
    missedFacts: missed,
    weighted,
    maxWeighted: MAX_WEIGHTED,
    coverage: weighted / MAX_WEIGHTED,
    falseClaim: assertsFalseAcquisition(t),
  };
}
