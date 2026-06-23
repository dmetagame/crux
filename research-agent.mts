/**
 * Autonomous research analyst — the differentiator of the RFB-01 entry.
 *
 * A real LLM (via the Vercel AI SDK + AI Gateway) researches a company under a
 * STRICT USDC budget, paying for marketplace sources with real nanopayments
 * that settle on Arc. The spending JUDGMENT is the product: it previews before
 * paying, matches source quality to importance, avoids redundant/misleading
 * sources, adapts when an unreliable source fails, and stops when it has enough.
 *
 * Run:  BASE_URL=http://localhost:3001 npm run research-agent
 * Env:  AI_GATEWAY_API_KEY, BUYER_PRIVATE_KEY (.env.local)
 * Args (optional): MODEL, TOPIC, BUDGET via env.
 */
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { catalog } from "./lib/marketplace.ts";

const MODEL = process.env.MODEL ?? "anthropic/claude-haiku-4.5";
const TOPIC = process.env.TOPIC ?? "Northwind Logistics";
const BUDGET = parseFloat(process.env.BUDGET ?? "0.05");
const BASE = process.env.BASE_URL ?? "http://localhost:3001";

const buyerKey = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
if (!buyerKey) throw new Error("Missing BUYER_PRIVATE_KEY");

const round = (n: number) => Math.round(n * 1e6) / 1e6;

interface LedgerEntry {
  n: number;
  sourceId: string;
  price: string;
  delivered: boolean;
  rationale: string;
}

// --- Gateway client for real USDC purchases on Arc ---
const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });
const bal = await gateway.getBalances();
const needAtomic = BigInt(Math.ceil(BUDGET * 1.2 * 1e6));
if (bal.gateway.available < needAtomic) {
  console.log(`Depositing ${Math.max(1, BUDGET * 2).toFixed(6)} USDC into Gateway...`);
  await gateway.deposit(Math.max(1, BUDGET * 2).toFixed(6));
}

let spent = 0;
const ledger: LedgerEntry[] = [];
let finalBrief = "";
let finalFacts: string[] = [];

const tools = {
  list_marketplace: tool({
    description:
      "List every research source: price, advertised quality, reliability, and a free preview where available. Free to call.",
    inputSchema: z.object({}),
    execute: async () => ({ sources: catalog() }),
  }),
  preview: tool({
    description:
      "Get the free preview + metadata for one source before deciding whether to pay. Free to call.",
    inputSchema: z.object({ sourceId: z.string() }),
    execute: async ({ sourceId }) => {
      const s = catalog().find((c) => c.id === sourceId);
      return s ?? { error: `Unknown source: ${sourceId}` };
    },
  }),
  check_budget: tool({
    description: "Check remaining USDC budget and the spend ledger so far. Free to call.",
    inputSchema: z.object({}),
    execute: async () => ({
      budget: BUDGET,
      spent: round(spent),
      remaining: round(BUDGET - spent),
      ledger,
    }),
  }),
  purchase: tool({
    description:
      "Pay for a source with REAL USDC (settles on Arc, irreversible). Give a one-line rationale. " +
      "Refused if it would exceed the budget. Some sources are unreliable and may return no usable " +
      "content even though payment settles — that risk is yours to manage.",
    inputSchema: z.object({
      sourceId: z.string(),
      rationale: z.string().describe("One line: why is paying for this worth it right now?"),
    }),
    execute: async ({ sourceId, rationale }) => {
      const meta = catalog().find((c) => c.id === sourceId);
      if (!meta) return { error: `Unknown source: ${sourceId}` };
      if (spent + meta.priceUsdc > BUDGET + 1e-9) {
        return {
          error: `Refused: would exceed budget. Remaining ${round(BUDGET - spent)} USDC, price ${meta.priceUsdc}.`,
        };
      }
      const url = `${BASE}${meta.purchaseUrl}?topic=${encodeURIComponent(TOPIC)}`;
      const res = await gateway.pay(url, { method: "GET" });
      const data = res.data as { delivered: boolean; content: string };
      spent += meta.priceUsdc;
      ledger.push({ n: ledger.length + 1, sourceId, price: meta.price, delivered: data.delivered, rationale });
      console.log(
        `  $ paid ${meta.price} for ${sourceId} ${data.delivered ? "(delivered)" : "(DEGRADED)"} — ${rationale}`,
      );
      return {
        delivered: data.delivered,
        content: data.content,
        spentSoFar: round(spent),
        remaining: round(BUDGET - spent),
      };
    },
  }),
  submit_brief: tool({
    description: "Submit the final due-diligence brief and finish. Ground every claim only in purchased content.",
    inputSchema: z.object({
      brief: z.string().describe("Concise due-diligence brief grounded only in what you purchased."),
      factsClaimed: z.array(z.string()).describe("The key facts you are confident you established."),
    }),
    execute: async ({ brief, factsClaimed }) => {
      finalBrief = brief;
      finalFacts = factsClaimed;
      return { ok: true };
    },
  }),
};

const system =
  `You are an autonomous research analyst. Produce a concise due-diligence brief on the requested ` +
  `company, working under a STRICT budget of ${BUDGET} USDC of REAL money.\n\n` +
  `You buy information from a marketplace of paid sources. Sources vary: price does NOT track quality, ` +
  `some are previewable for free, some are unreliable (may take your payment and return nothing useful), ` +
  `and at least one is cheap but misleading. Two cheap sources overlap heavily.\n\n` +
  `Spend wisely:\n` +
  `- Use list_marketplace and the free preview to judge value BEFORE paying.\n` +
  `- Match what you buy to what matters most; don't overpay for trivia or buy redundant sources.\n` +
  `- Every purchase costs real USDC and is irreversible. Give a one-line rationale for each.\n` +
  `- If an unreliable source returns nothing useful, adapt — don't blindly re-buy it.\n` +
  `- Stop buying once you can write a credible brief; leftover budget is a good outcome.\n` +
  `- Ground every claim ONLY in content you actually purchased. Do not invent facts. Treat rumor/` +
  `unverified sources with skepticism and corroborate red flags where you can.\n\n` +
  `When finished, call submit_brief with the brief and the key facts you established.`;

console.log(`\nAgent: ${MODEL}  |  Topic: ${TOPIC}  |  Budget: $${BUDGET}\n`);

const result = await generateText({
  model: MODEL,
  system,
  prompt: `Produce a due-diligence brief on "${TOPIC}". Your budget is ${BUDGET} USDC.`,
  tools,
  stopWhen: stepCountIs(30),
});

console.log("\n" + "=".repeat(70));
console.log("BRIEF\n");
console.log(finalBrief || "(no brief submitted)");
console.log("\nFACTS CLAIMED:");
for (const f of finalFacts) console.log("  •", f);

console.log("\n" + "=".repeat(70));
console.log("SPEND LEDGER");
for (const e of ledger) {
  console.log(`  ${e.n}. ${e.price} ${e.sourceId} ${e.delivered ? "" : "[DEGRADED] "}— ${e.rationale}`);
}
console.log(`\nTotal spent: $${round(spent)} / $${BUDGET} budget   (purchases: ${ledger.length})`);
console.log(`LLM steps: ${result.steps.length}   tokens: ${result.usage?.totalTokens ?? "?"}`);
