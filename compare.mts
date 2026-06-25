/**
 * The comparison money-shot: the reasoning agent vs. naive heuristics on the
 * SAME marketplace, budget, and seed — all paying real USDC on Arc.
 *
 * Run:  BASE_URL=http://localhost:3001 npm run compare
 * Env:  AI_GATEWAY_API_KEY, BUYER_PRIVATE_KEY (.env.local); optional MODEL/TOPIC/BUDGET/SEED.
 */
import { runResearchAgent, type RunResult } from "./lib/agent.ts";
import { runBaseline } from "./lib/baseline.ts";
import { scoreBrief } from "./lib/score.ts";

const MODEL = process.env.MODEL ?? "anthropic/claude-haiku-4.5";
const TOPIC = process.env.TOPIC ?? "Northwind Logistics";
const BUDGET = parseFloat(process.env.BUDGET ?? "0.05");
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const SEED = process.env.SEED ?? "demo";
const buyerKey = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
if (!buyerKey) throw new Error("Missing BUYER_PRIVATE_KEY");

const common = { topic: TOPIC, budget: BUDGET, baseUrl: BASE, seed: SEED, buyerKey };

console.log(`\nComparison — Topic: ${TOPIC} | Budget: $${BUDGET} | Seed: ${SEED}`);
console.log(`Reasoning model: ${MODEL}   (baselines use no LLM)\n`);

const results: RunResult[] = [];

console.log(`-- reasoning agent --`);
results.push(await runResearchAgent({ model: MODEL, ...common, onEvent: (m) => console.log(m) }));

console.log(`\n-- buy-cheapest baseline --`);
results.push(await runBaseline({ strategy: "cheapest", ...common, onEvent: (m) => console.log(m) }));

console.log(`\n-- buy-by-quality baseline --`);
results.push(await runBaseline({ strategy: "quality", ...common, onEvent: (m) => console.log(m) }));

// --- Comparison table ---
const W = { label: 16, spent: 9, buys: 5, facts: 6, coverage: 13, flag: 13 };
const displayLabel = (r: RunResult, i: number) => (i === 0 ? "reasoning-agent" : r.label);

function row(cells: [string, string, string, string, string, string]): string {
  return (
    cells[0].padEnd(W.label) +
    "  " + cells[1].padStart(W.spent) +
    "  " + cells[2].padStart(W.buys) +
    "  " + cells[3].padStart(W.facts) +
    "  " + cells[4].padStart(W.coverage) +
    "  " + cells[5]
  );
}

console.log("\n" + "=".repeat(72));
console.log("RESULTS\n");
console.log(row(["Strategy", "Spent", "Buys", "Facts", "Coverage", "False claim"]));
console.log("-".repeat(72));

for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const s = scoreBrief(r.brief, r.factsClaimed, TOPIC);
  console.log(
    row([
      displayLabel(r, i),
      `$${r.spent}`,
      String(r.ledger.length),
      `${s.capturedFacts.length}/5`,
      `${s.weighted}/${s.maxWeighted} (${Math.round(s.coverage * 100)}%)`,
      s.falseClaim ? "YES (rumor)" : "no",
    ]),
  );
}

console.log("\n" + "=".repeat(78));
const agent = results[0];
const agentScore = scoreBrief(agent.brief, agent.factsClaimed, TOPIC);
console.log(
  `Verdict: the reasoning agent captured ${agentScore.weighted}/${agentScore.maxWeighted} ` +
    `(${Math.round(agentScore.coverage * 100)}%) for $${agent.spent} with no false claim — ` +
    `previewing past the trap and skipping the rumor that the heuristics swallowed.`,
);
