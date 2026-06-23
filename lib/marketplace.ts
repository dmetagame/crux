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
      "Auto-summary of public headlines (overlaps the Sector News Feed). Sample: 'Company reports strong growth this year.'",
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

/** Full (good) payload per source for the demo topic. */
const DEMO_CONTENT: Record<string, string> = {
  financials:
    "Audited FY2026 financials for Northwind Logistics. Revenue $2.10B, up 40.2% YoY (F1). " +
    "Cash & equivalents $180M against $45M total debt — strong, low-leverage balance sheet (F4). " +
    "Operating margin 11.4%. No going-concern qualifications in the audit opinion.",
  "premium-analysis":
    "Analyst diligence memo — Northwind Logistics. Three material concerns: (1) the CEO departed " +
    "abruptly in Q2 2026 with no permanent successor named (F2); (2) the company is under SEC " +
    "investigation regarding revenue-recognition timing (F3); (3) revenue is concentrated — the " +
    "single largest customer represents ~35% of total revenue (F5). Recommend caution pending resolution.",
  "raw-filings":
    "Form 8-K / litigation exhibits (dense legal text). Buried in Item 8.01: '...the Company received " +
    "a formal order of investigation from the Division of Enforcement concerning the timing of certain " +
    "revenue recognition...' (F3). Requires careful reading to extract.",
  "sector-news":
    "SECTOR FEED: 'Logistics demand rebounds in 2026.' 'Northwind posts record quarter, revenue up ~40% (F1).' " +
    "'Freight rates stabilize.' 'Analysts debate sector multiples.' (Mostly headline-level; no governance or regulatory detail.)",
  "cheap-digest":
    "AUTO-DIGEST: 'Northwind reported strong growth this year, with revenue up about 40% (F1).' " +
    "(Generated from the same public headlines as the Sector News Feed — largely redundant with it.)",
  "social-sentiment":
    "Social sentiment for Northwind: 52/100 (mixed), trend flat. Chatter volume moderate. " +
    "No specific, verifiable claims — mood signal only.",
  "insider-interview":
    "Interview transcript (former operations lead): 'The leadership change in Q2 caught everyone off guard (F2). " +
    "And honestly, lose the top account and the numbers look very different — it's a big chunk of revenue (F5).'",
  "rumor-wire":
    "RUMOR WIRE: 'Sources say a major acquisition of Northwind is imminent at a huge premium!!' " +
    "(UNVERIFIED and, per ground truth, FALSE — no such deal exists. Pure noise / misleading.)",
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

/**
 * Produce the paid payload for a source on a topic. Applies the reliability
 * simulation: an unreliable source returns degraded content with probability
 * (1 - reliability), even though payment still settles.
 */
export function getSourceContent(id: string, topic: string): SourceResult {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) {
    throw new Error(`Unknown source: ${id}`);
  }

  const delivered = Math.random() < source.reliability;

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

/** Public catalog view — metadata + free preview only, never paid content. */
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
    preview: s.preview,
    purchaseUrl: `/api/research/${s.id}`,
  }));
}
