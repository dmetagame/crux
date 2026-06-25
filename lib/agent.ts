/**
 * Reusable autonomous research-agent core (AI SDK + AI Gateway).
 *
 * Extracted so the CLI (research-agent.mts) and the baseline comparison
 * (compare.mts) share the exact same marketplace, real on-chain settlement, and
 * scorer. Pure: takes options, returns a RunResult — no env reads, no printing
 * (callers pass an onEvent logger if they want live output).
 */
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { catalog, getPreview } from "./marketplace.ts";

export interface LedgerEntry {
  n: number;
  sourceId: string;
  price: string;
  delivered: boolean;
  rationale: string;
  /** On-chain settlement tx/batch id from gateway.pay (Arc testnet). */
  tx?: string;
}

/** Structured live events, for both the CLI and the streaming web UI. */
export type AgentEvent =
  | { kind: "preview"; sourceId: string }
  | {
      kind: "purchase";
      sourceId: string;
      price: string;
      delivered: boolean;
      rationale: string;
      tx?: string;
    };

export interface RunResult {
  label: string;
  model: string;
  brief: string;
  factsClaimed: string[];
  ledger: LedgerEntry[];
  spent: number;
  steps: number;
  tokens: number;
  previews: number;
}

export interface RunOpts {
  model: string;
  topic: string;
  budget: number;
  baseUrl: string;
  seed: string;
  buyerKey: `0x${string}`;
  onEvent?: (e: AgentEvent) => void;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Deposit into Gateway if the available balance can't cover the budget. */
export async function ensureGatewayFunded(
  gateway: GatewayClient,
  budget: number,
): Promise<void> {
  const bal = await gateway.getBalances();
  if (bal.gateway.available < BigInt(Math.ceil(budget * 1.2 * 1e6))) {
    await gateway.deposit(Math.max(1, budget * 2).toFixed(6));
  }
}

export async function runResearchAgent(opts: RunOpts): Promise<RunResult> {
  const { model, topic, budget, baseUrl, seed, buyerKey, onEvent } = opts;
  const emit = onEvent ?? (() => {});

  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: buyerKey });
  await ensureGatewayFunded(gateway, budget);

  let spent = 0;
  let previews = 0;
  const ledger: LedgerEntry[] = [];
  let finalBrief = "";
  let finalFacts: string[] = [];

  const tools = {
    list_marketplace: tool({
      description:
        "List every research source: price, advertised quality, reliability, and category. Free to call. The listing does NOT include previews.",
      inputSchema: z.object({}),
      execute: async () => ({ sources: catalog() }),
    }),
    preview: tool({
      description:
        "Get the free preview/sample for one source before deciding whether to pay. " +
        "Use this to inspect a source whose relevance is unclear from the listing. Free to call.",
      inputSchema: z.object({ sourceId: z.string() }),
      execute: async ({ sourceId }) => {
        const meta = catalog().find((c) => c.id === sourceId);
        if (!meta) return { error: `Unknown source: ${sourceId}` };
        previews++;
        emit({ kind: "preview", sourceId });
        return { id: sourceId, name: meta.name, hasPreview: meta.hasPreview, preview: getPreview(sourceId).preview };
      },
    }),
    check_budget: tool({
      description: "Check remaining USDC budget and the spend ledger so far. Free to call.",
      inputSchema: z.object({}),
      execute: async () => ({ budget, spent: round(spent), remaining: round(budget - spent), ledger }),
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
        if (spent + meta.priceUsdc > budget + 1e-9) {
          return { error: `Refused: would exceed budget. Remaining ${round(budget - spent)} USDC, price ${meta.priceUsdc}.` };
        }
        const url = `${baseUrl}${meta.purchaseUrl}?topic=${encodeURIComponent(topic)}&seed=${encodeURIComponent(seed)}`;
        const res = await gateway.pay(url, { method: "GET" });
        const data = res.data as { delivered: boolean; content: string };
        const tx = (res as { transaction?: string }).transaction || undefined;
        spent += meta.priceUsdc;
        ledger.push({ n: ledger.length + 1, sourceId, price: meta.price, delivered: data.delivered, rationale, tx });
        emit({ kind: "purchase", sourceId, price: meta.price, delivered: data.delivered, rationale, tx });
        return { delivered: data.delivered, content: data.content, spentSoFar: round(spent), remaining: round(budget - spent) };
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
    `company, working under a STRICT budget of ${budget} USDC of REAL money.\n\n` +
    `You buy information from a marketplace of paid sources. Sources vary: price does NOT track quality, ` +
    `some are previewable for free, some are unreliable (may take your payment and return nothing useful), ` +
    `and at least one is cheap but misleading. Two cheap sources overlap heavily.\n\n` +
    `Spend wisely:\n` +
    `- Use list_marketplace to see what's on offer. The listing does NOT include previews.\n` +
    `- Sources can look similar on paper. When a source's actual relevance to THIS company is ` +
    `unclear from its listing, use the free preview to inspect a sample BEFORE paying.\n` +
    `- Match what you buy to what matters most; don't overpay for trivia or buy redundant sources.\n` +
    `- Macro or industry/sector-level material (market-size, growth forecasts, sector outlooks) rarely ` +
    `changes a COMPANY-specific due-diligence conclusion — prioritise company-specific evidence and don't ` +
    `spend budget on macro context.\n` +
    `- Every purchase costs real USDC and is irreversible. Give a one-line rationale for each.\n` +
    `- If an unreliable source returns nothing useful, adapt — don't blindly re-buy it.\n` +
    `- Stop buying once you can write a credible brief; leftover budget is a good outcome.\n` +
    `- Ground every claim ONLY in content you actually purchased. Do not invent facts. Treat rumor/` +
    `unverified sources with skepticism and corroborate red flags where you can.\n\n` +
    `When finished, call submit_brief with the brief and the key facts you established.`;

  const result = await generateText({
    model,
    system,
    prompt: `Produce a due-diligence brief on "${topic}". Your budget is ${budget} USDC.`,
    tools,
    stopWhen: stepCountIs(30),
  });

  return {
    label: `agent (${model})`,
    model,
    brief: finalBrief,
    factsClaimed: finalFacts,
    ledger,
    spent: round(spent),
    steps: result.steps.length,
    tokens: result.usage?.totalTokens ?? 0,
    previews,
  };
}
