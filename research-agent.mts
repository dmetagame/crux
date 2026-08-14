/**
 * CLI for the autonomous research agent (thin wrapper over lib/agent.ts).
 *
 * Run:  BASE_URL=http://localhost:3001 npm run research-agent
 * Env:  AI_GATEWAY_API_KEY, CRUX_HOUSE_TESTNET_PRIVATE_KEY (.env.local)
 * Args (optional, via env): MODEL, TOPIC, BUDGET, SEED.
 */
import { runResearchAgent } from "./lib/agent.ts";
import { scoreBrief } from "./lib/score.ts";
import { requireHousePrivateKey } from "./lib/wallet-keys.ts";
import { configuredDefaultAgentModel } from "./lib/agent-model-defaults.ts";

const MODEL = process.env.MODEL ?? configuredDefaultAgentModel();
const TOPIC = process.env.TOPIC ?? "Northwind Logistics";
const BUDGET = parseFloat(process.env.BUDGET ?? "0.05");
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const SEED = process.env.SEED ?? "demo";
const buyerKey = requireHousePrivateKey();

console.log(`\nAgent: ${MODEL}  |  Topic: ${TOPIC}  |  Budget: $${BUDGET}  |  Seed: ${SEED}\n`);

const r = await runResearchAgent({
  model: MODEL,
  topic: TOPIC,
  budget: BUDGET,
  baseUrl: BASE,
  seed: SEED,
  buyerKey,
  onEvent: (e) =>
    console.log(
      e.kind === "preview"
        ? `  ? previewed ${e.sourceId} (free)`
        : `  $ paid ${e.price} for ${e.sourceId} ${e.delivered ? "(delivered)" : "(DEGRADED)"} — ${e.rationale}`,
    ),
});

console.log("\n" + "=".repeat(70));
console.log("BRIEF\n");
console.log(r.brief || "(no brief submitted)");
console.log("\nFACTS CLAIMED:");
for (const f of r.factsClaimed) console.log("  •", f);

console.log("\n" + "=".repeat(70));
console.log("SPEND LEDGER");
for (const e of r.ledger) {
  console.log(`  ${e.n}. ${e.price} ${e.sourceId} ${e.delivered ? "" : "[DEGRADED] "}— ${e.rationale}`);
}
console.log(`\nTotal spent: $${r.spent} / $${BUDGET} budget   (purchases: ${r.ledger.length}, previews: ${r.previews})`);
console.log(`LLM steps: ${r.steps}   tokens: ${r.tokens}`);

const score = scoreBrief(r.brief, r.factsClaimed, TOPIC);
console.log("\n" + "=".repeat(70));
console.log("SCORE vs ground truth");
console.log(`  Facts captured: ${score.capturedFacts.map((f) => f.id).join(", ") || "none"} (${score.capturedFacts.length}/5)`);
if (score.missedFacts.length) console.log(`  Missed: ${score.missedFacts.map((f) => f.id).join(", ")}`);
console.log(`  Weighted coverage: ${score.weighted}/${score.maxWeighted} (${Math.round(score.coverage * 100)}%)`);
console.log(`  False claim ingested: ${score.falseClaim ? "YES (the acquisition rumor)" : "no"}`);
console.log(`  => ${Math.round(score.coverage * 100)}% coverage for $${r.spent} spent`);
