/**
 * Research marketplace — the decision space for the autonomous paying agent.
 *
 * Each source is an x402-priced data feed the agent can buy while researching a
 * topic. The catalog is deliberately built so that NO fixed heuristic wins:
 *  - quality is NOT correlated with price (some cheap sources are good signal,
 *    some pricey ones are noise or unreliable),
 *  - some sources are previewable for free (the agent must judge value
 *    semantically before paying), others are pay-to-see,
 *  - two cheap sources overlap heavily (caching / dedup matters),
 *  - one high-value source is unreliable (must adapt, not blindly re-buy),
 *  - one cheap source is actively misleading (the "buy cheapest" trap).
 *
 * Only context-sensitive judgment — matching source to sub-question, reading
 * previews, stopping when enough — spends the budget well. That is what makes
 * a real LLM load-bearing here rather than decorative.
 */

export type Quality = "high" | "medium" | "low" | "misleading";

export interface SourceMeta {
  id: string;
  name: string;
  category: string;
  /** x402 price string consumed by withGateway, e.g. "$0.01". */
  price: string;
  /** Numeric USDC price, for budgeting/sorting. */
  priceUsdc: number;
  /** Quality the source ADVERTISES (the agent learns the truth only by buying). */
  advertisedQuality: Quality;
  /** Probability the paid response is the full, useful payload (0..1). */
  reliability: number;
  reliabilityLabel: string;
  /** Whether a free preview/sample is available before paying. */
  hasPreview: boolean;
  /** Free sample shown in the catalog (null when pay-to-see). */
  preview: string | null;
}

export const SOURCES: SourceMeta[] = [
  {
    id: "financials",
    name: "Audited Financial Statements",
    category: "financial-data",
    price: "$0.01",
    priceUsdc: 0.01,
    advertisedQuality: "high",
    reliability: 0.99,
    reliabilityLabel: "99%",
    hasPreview: true,
    preview:
      "Structured income statement, balance sheet & cash-flow extract. Sample: 'FY2026 revenue line and total-debt line included.'",
  },
  {
    id: "premium-analysis",
    name: "Analyst Deep-Dive",
    category: "expert-analysis",
    price: "$0.03",
    priceUsdc: 0.03,
    advertisedQuality: "high",
    reliability: 0.99,
    reliabilityLabel: "99%",
    hasPreview: true,
    preview:
      "Abstract: 'Our diligence flags governance and disclosure concerns alongside a customer-concentration risk. Full memo covers management changes and regulatory exposure.'",
  },
  {
    id: "raw-filings",
    name: "Primary Regulatory Filings",
    category: "primary-source",
    price: "$0.005",
    priceUsdc: 0.005,
    advertisedQuality: "high",
    reliability: 0.99,
    reliabilityLabel: "99%",
    hasPreview: false,
    preview: null,
  },
  {
    id: "sector-news",
    name: "Sector News Feed",
    category: "news",
    price: "$0.001",
    priceUsdc: 0.001,
    advertisedQuality: "medium",
    reliability: 0.99,
    reliabilityLabel: "99%",
    hasPreview: true,
    preview:
      "Headlines: 'Logistics demand rebounds'; 'Northwind posts record quarter'; plus general sector commentary.",
  },
  {
    id: "cheap-digest",
    name: "Auto-Generated Digest",
    category: "summary",
    price: "$0.0005",
    priceUsdc: 0.0005,
    advertisedQuality: "medium",
    reliability: 0.99,
    reliabilityLabel: "99%",
    hasPreview: true,
    preview:
      "Auto-generated summary of public headlines. Sample: 'Company reports strong growth this year.'",
  },
  {
    id: "social-sentiment",
    name: "Social Sentiment Index",
    category: "sentiment",
    price: "$0.002",
    priceUsdc: 0.002,
    advertisedQuality: "medium",
    reliability: 0.99,
    reliabilityLabel: "99%",
    hasPreview: true,
    preview: "Aggregate mood score and trend arrow. Sample: 'Sentiment: mixed (52/100).'",
  },
  {
    id: "insider-interview",
    name: "Insider Interview Transcript",
    category: "expert-interview",
    price: "$0.025",
    priceUsdc: 0.025,
    advertisedQuality: "high",
    reliability: 0.65,
    reliabilityLabel: "~65% (often unavailable)",
    hasPreview: true,
    preview:
      "Teaser: 'Former operations lead discusses leadership turnover and top-customer dependence.' Note: source frequently returns 'no transcript available'.",
  },
  {
    id: "rumor-wire",
    name: "Rumor Wire",
    category: "rumor",
    price: "$0.0003",
    priceUsdc: 0.0003,
    advertisedQuality: "high",
    reliability: 0.99,
    reliabilityLabel: "99% delivered (accuracy not guaranteed)",
    hasPreview: true,
    preview: "Unverified chatter, delivered instantly and cheaply. Sample: 'Big news brewing...'",
  },
];

/**
 * Ground-truth key facts for the demo topic. The quality of a produced brief is
 * how many of these the agent assembled, weighted by importance, vs. budget spent.
 * Used later by the eval / baseline comparison.
 */
export const DEMO_TOPIC = "northwind logistics";

export const GROUND_TRUTH = [
  { id: "F1", weight: 1, fact: "Revenue grew ~40% YoY to $2.1B in FY2026." },
  { id: "F2", weight: 3, fact: "CEO departed abruptly in Q2 2026 (governance red flag)." },
  {
    id: "F3",
    weight: 4,
    fact: "Under SEC investigation over revenue-recognition practices (major red flag).",
  },
  { id: "F4", weight: 1, fact: "Strong balance sheet: ~$180M cash, minimal leverage." },
  {
    id: "F5",
    weight: 2,
    fact: "Customer concentration risk: top client is ~35% of revenue.",
  },
] as const;

function isDemoTopic(topic: string): boolean {
  return topic.trim().toLowerCase().includes("northwind");
}

/**
 * Full (good) payload per source for the demo topic. Written to read like real
 * source material — no answer-key tags or self-labels. The mapping from content
 * to ground-truth facts lives only in the scorer (lib/score.ts).
 */
const DEMO_CONTENT: Record<string, string> = {
  financials:
    "Audited financial statements, Northwind Logistics, fiscal year 2026. Revenue of $2.10 billion, " +
    "up 40.2% from the prior year. Cash and equivalents of $180 million against total debt of $45 million. " +
    "Operating margin 11.4%. The independent auditor's opinion contains no going-concern qualification.",
  "premium-analysis":
    "Diligence memo — Northwind Logistics. We flag three material concerns. First, the chief executive " +
    "departed abruptly in the second quarter of 2026 and no permanent successor has been named. Second, " +
    "the company has disclosed that the SEC's Division of Enforcement is examining the timing of certain " +
    "revenue recognition. Third, customer concentration is high — the single largest customer accounts for " +
    "roughly 35% of total revenue. We recommend caution pending resolution of these items.",
  "raw-filings":
    "Form 8-K, Item 8.01 (Other Events): '...the Company received a formal order of investigation from the " +
    "Division of Enforcement concerning the timing of certain revenue recognition during the periods under " +
    "review...'. The surrounding exhibits are procedural and densely worded.",
  "sector-news":
    "Logistics demand rebounded across 2026. Northwind posted a record quarter, with revenue up roughly 40%. " +
    "Freight rates have stabilized after last year's volatility, and analysts continue to debate sector valuation multiples.",
  "cheap-digest":
    "Northwind reported strong growth this year, with revenue up about 40%. Overall a solid performance in a recovering freight market.",
  "social-sentiment":
    "Aggregate social sentiment for Northwind: 52 out of 100 (mixed), trend flat. Moderate chatter volume. " +
    "No specific or verifiable claims — a mood signal only.",
  "insider-interview":
    "Interview with a former operations lead. 'The leadership change in Q2 caught everyone off guard. " +
    "And honestly, if we lost the top account the numbers would look very different — it's a big chunk of our revenue.'",
  "rumor-wire":
    "Word going around is that a major acquisition of Northwind is imminent, reportedly at a big premium. " +
    "Nothing official, but people are talking.",
};

/** Degraded payload when an unreliable source fails to deliver. */
const DEGRADED_CONTENT: Record<string, string> = {
  "insider-interview":
    "No transcript available — the requested insider could not be reached for this topic. " +
    "(Payment settled, but no usable content was returned.)",
};

export interface SourceResult {
  sourceId: string;
  name: string;
  topic: string;
  /** Whether the source delivered its full payload this time. */
  delivered: boolean;
  advertisedQuality: Quality;
  pricePaid: string;
  content: string;
}

/** Deterministic [0,1) hash of a string (FNV-1a) — for reproducible runs. */
function seededUnit(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Produce the paid payload for a source on a topic. The reliability simulation
 * is DETERMINISTIC under a given seed so demo runs and baseline comparisons are
 * reproducible: highly-reliable sources always deliver; only sub-0.9 sources
 * (the insider interview) swing, decided by a seeded hash. Payment settles
 * regardless of whether usable content is returned.
 */
export function getSourceContent(
  id: string,
  topic: string,
  seed = "demo",
): SourceResult {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) {
    throw new Error(`Unknown source: ${id}`);
  }

  const delivered =
    source.reliability >= 0.9
      ? true
      : seededUnit(`${id}:${topic}:${seed}`) < source.reliability;

  let content: string;
  if (!isDemoTopic(topic)) {
    content =
      `(${source.name}) No curated dataset for "${topic}". This demo is wired for ` +
      `"Northwind Logistics"; other topics return placeholder content only.`;
  } else if (delivered) {
    content = DEMO_CONTENT[id] ?? `(${source.name}) No content configured.`;
  } else {
    content =
      DEGRADED_CONTENT[id] ??
      `(${source.name}) Source temporarily returned no usable content. (Payment settled.)`;
  }

  return {
    sourceId: id,
    name: source.name,
    topic,
    delivered,
    advertisedQuality: source.advertisedQuality,
    pricePaid: source.price,
    content,
  };
}

/**
 * Public catalog view — metadata only, NO preview text and never paid content.
 * Withholding the preview forces the agent to actively decide what to inspect
 * via the separate preview() tool, rather than being handed every sample.
 */
export function catalog() {
  return SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    price: s.price,
    priceUsdc: s.priceUsdc,
    advertisedQuality: s.advertisedQuality,
    reliability: s.reliabilityLabel,
    hasPreview: s.hasPreview,
    purchaseUrl: `/api/research/${s.id}`,
  }));
}

/** Free preview/sample for one source (the agent's preview() tool). */
export function getPreview(id: string): { id: string; preview: string | null } {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) {
    throw new Error(`Unknown source: ${id}`);
  }
  return { id, preview: source.preview };
}
