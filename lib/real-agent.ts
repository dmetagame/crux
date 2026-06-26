/**
 * Real-subject research agent — the traction half of the hybrid.
 *
 * Same autonomous spend loop as ./agent.ts, but the marketplace is live public
 * data (./real-sources.ts) and the subject is whatever the user types. There is
 * no ground truth to score against; instead the agent must GROUND every claim in
 * purchased content and the brief carries citations. The hard judgement is the
 * same one a real budget-bound research agent faces: which real sources are
 * worth paying for given what this specific subject actually is.
 */
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { realCatalog, getRealPreview } from "./real-sources.ts";
import { ensureGatewayFunded, type AgentEvent, type LedgerEntry } from "./agent.ts";

export interface RealRunResult {
  label: string;
  model: string;
  subject: string;
  brief: string;
  factsClaimed: string[];
  citations: { sourceId: string; url: string }[];
  ledger: LedgerEntry[];
  spent: number;
  steps: number;
  tokens: number;
  previews: number;
}

export interface RealRunOpts {
  model: string;
  subject: string;
  budget: number;
  baseUrl: string;
  buyerKey: `0x${string}`;
  onEvent?: (e: AgentEvent) => void;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export async function runRealResearchAgent(opts: RealRunOpts): Promise<RealRunResult> {
  const { model, subject, budget, baseUrl, buyerKey, onEvent } = opts;
  const emit = onEvent ?? (() => {});

  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });
  await ensureGatewayFunded(gateway, budget);

  let spent = 0;
  let previews = 0;
  const ledger: LedgerEntry[] = [];
  const citations: { sourceId: string; url: string }[] = [];
  let finalBrief = "";
  let finalFacts: string[] = [];

  const tools = {
    list_marketplace: tool({
      description:
        "List every real data source: price, category, and how to buy it. Free to call. Does NOT include previews.",
      inputSchema: z.object({}),
      execute: async () => ({ subject, sources: realCatalog() }),
    }),
    preview: tool({
      description:
        "Get the free description of one source — what it returns and when it's worth buying for THIS subject. Free to call.",
      inputSchema: z.object({ sourceId: z.string() }),
      execute: async ({ sourceId }) => {
        const meta = realCatalog().find((c) => c.id === sourceId);
        if (!meta) return { error: `Unknown source: ${sourceId}` };
        previews++;
        emit({ kind: "preview", sourceId });
        return { id: sourceId, name: meta.name, preview: getRealPreview(sourceId).preview };
      },
    }),
    check_budget: tool({
      description: "Check remaining USDC budget and the spend ledger so far. Free to call.",
      inputSchema: z.object({}),
      execute: async () => ({ budget, spent: round(spent), remaining: round(budget - spent), ledger }),
    }),
    purchase: tool({
      description:
        "Pay for a source with REAL USDC (settles on Arc, irreversible). Give a one-line rationale. Refused if it " +
        "would exceed budget. A source may return delivered:false (no data for this subject) even though payment " +
        "settles — that risk is yours; don't blindly re-buy.",
      inputSchema: z.object({
        sourceId: z.string(),
        rationale: z.string().describe("One line: why is paying for this worth it for THIS subject?"),
      }),
      execute: async ({ sourceId, rationale }) => {
        const meta = realCatalog().find((c) => c.id === sourceId);
        if (!meta) return { error: `Unknown source: ${sourceId}` };
        if (spent + meta.priceUsdc > budget + 1e-9) {
          return { error: `Refused: would exceed budget. Remaining ${round(budget - spent)} USDC, price ${meta.priceUsdc}.` };
        }
        const url = `${baseUrl}${meta.purchaseUrl}?subject=${encodeURIComponent(subject)}`;
        const res = await gateway.pay(url, { method: "GET" });
        const data = res.data as { delivered: boolean; content: string; citationUrl: string | null };
        const tx = (res as { transaction?: string }).transaction || undefined;
        spent += meta.priceUsdc;
        ledger.push({ n: ledger.length + 1, sourceId, price: meta.price, delivered: data.delivered, rationale, tx });
        if (data.delivered && data.citationUrl) citations.push({ sourceId, url: data.citationUrl });
        emit({ kind: "purchase", sourceId, price: meta.price, delivered: data.delivered, rationale, tx });
        return { delivered: data.delivered, content: data.content, spentSoFar: round(spent), remaining: round(budget - spent) };
      },
    }),
    submit_brief: tool({
      description: "Submit the final research brief and finish. Ground every claim only in purchased content.",
      inputSchema: z.object({
        brief: z.string().describe("Concise research brief grounded only in what you purchased."),
        factsClaimed: z.array(z.string()).describe("The key facts you established, each from a purchased source."),
      }),
      execute: async ({ brief, factsClaimed }) => {
        finalBrief = brief;
        finalFacts = factsClaimed;
        return { ok: true };
      },
    }),
  };

  const system =
    `You are an autonomous research analyst with a STRICT budget of ${budget} USDC of REAL money. You research a ` +
    `subject the user names by buying live data from paid sources, then write a short, well-grounded brief.\n\n` +
    `The sources fetch REAL public data at purchase time. They differ in what they're good for:\n` +
    `- Some are broad (encyclopedic) and useful for almost any notable subject.\n` +
    `- Some overlap heavily with each other — buying both is usually wasteful.\n` +
    `- The regulatory/filings source is authoritative but ONLY returns data for U.S. PUBLIC companies; it is dead ` +
    `money for a private company, a non-U.S. entity, a person, or a topic. Judge what the subject IS before buying it.\n` +
    `- A source can take your payment and still return nothing useful for an obscure subject — adapt, don't re-buy.\n\n` +
    `Spend wisely: preview (free) when a source's fit is unclear, match purchases to what the subject actually is, ` +
    `avoid redundant buys, stop once you can write a credible brief, and leave budget unspent when you can. ` +
    `Ground EVERY claim only in content you purchased — never invent facts. ` +
    `When finished, call submit_brief.`;

  const result = await generateText({
    model,
    system,
    prompt: `Research the subject "${subject}" and produce a grounded brief. Your budget is ${budget} USDC.`,
    tools,
    stopWhen: stepCountIs(30),
  });

  return {
    label: `real-agent (${model})`,
    model,
    subject,
    brief: finalBrief,
    factsClaimed: finalFacts,
    citations,
    ledger,
    spent: round(spent),
    steps: result.steps.length,
    tokens: result.usage?.totalTokens ?? 0,
    previews,
  };
}
