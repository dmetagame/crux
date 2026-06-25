/**
 * Research marketplace — the decision space for the autonomous paying agent.
 *
 * Source METADATA (price/quality/reliability/preview) is shared across topics
 * and deliberately built so NO fixed heuristic wins: quality is uncorrelated
 * with price, some sources are previewable and others pay-to-see, two cheap
 * sources overlap, one high-value source is unreliable, one cheap source is
 * misleading, and one ("industry-report") looks identical to the best source
 * but is industry-macro — useless for any specific company.
 *
 * The CONTENT, ground-truth facts, and misinformation are keyed by TOPIC, so
 * the same marketplace serves multiple companies with distinct risk profiles.
 * Only context-sensitive judgment spends the budget well — that is what makes a
 * real LLM load-bearing here rather than decorative.
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
  /** Free, topic-independent sample shown via the preview() tool (null when pay-to-see). */
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
    preview: "Structured income statement, balance sheet & cash-flow extract for the company.",
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
      "Abstract: 'Independent diligence memo covering governance, disclosures, and the key business risks specific to this company.'",
  },
  {
    // Trap: metadata is indistinguishable from premium-analysis (expert-analysis,
    // high, 99%, fair price), but the preview reveals it is sector-MACRO, not
    // company-specific — useless for any company's due diligence. Detectable only
    // by reading the preview/content. A metadata-only heuristic wastes budget here.
    id: "industry-report",
    name: "Premium Industry Outlook",
    category: "expert-analysis",
    price: "$0.02",
    priceUsdc: 0.02,
    advertisedQuality: "high",
    reliability: 0.99,
    reliabilityLabel: "99%",
    hasPreview: true,
    preview: "Sample: 'Sector market-size and multi-year growth forecast; macro demand and capacity trends.'",
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
    preview: "Headlines and general market/sector commentary that mention the company.",
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
    preview: "Auto-generated summary of public headlines. Sample: 'Company reports growth this year.'",
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
    preview: "Aggregate mood score and trend arrow. Sample: 'Sentiment: mixed.'",
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
      "Teaser: 'A former insider discusses leadership and key business dependencies.' Note: source frequently returns 'no transcript available'.",
  },
  {
    id: "rumor-wire",
    name: "Rumor Wire",
    category: "rumor",
    price: "$0.0003",
    priceUsdc: 0.0003,
    advertisedQuality: "high",
    reliabilityLabel: "99% delivered (accuracy not guaranteed)",
    reliability: 0.99,
    hasPreview: true,
    preview: "Unverified chatter, delivered instantly and cheaply. Sample: 'Big news brewing...'",
  },
];

// ---------------------------------------------------------------------------
// Topics — content + ground truth + misinformation, keyed by company.
// ---------------------------------------------------------------------------

export interface Fact {
  id: string;
  weight: number;
  fact: string;
  /** Detector run by the scorer against the lowercased brief text. */
  match: (t: string) => boolean;
}

export interface Topic {
  key: string; // normalized substring used to resolve a free-text topic
  name: string;
  blurb: string; // one-liner for listings / UI
  groundTruth: Fact[];
  /** sourceId -> delivered content for this company. */
  content: Record<string, string>;
  /** Detects a brief that ingested this company's misleading rumor as fact. */
  falseClaim: (t: string) => boolean;
}

export const TOPICS: Record<string, Topic> = {
  northwind: {
    key: "northwind",
    name: "Northwind Logistics",
    blurb: "Freight & logistics — fast growth shadowed by governance and regulatory red flags.",
    groundTruth: [
      {
        id: "F1",
        weight: 1,
        fact: "Revenue grew ~40% YoY to $2.1B in FY2026.",
        match: (t) => /\b2\.1\s*(billion|bn|b)\b/.test(t) || /\b40(\.\d+)?\s*%/.test(t),
      },
      {
        id: "F2",
        weight: 3,
        fact: "CEO departed abruptly in Q2 2026 (governance red flag).",
        match: (t) =>
          /\b(ceo|chief executive)\b/.test(t) &&
          /(depart|resign|left|step(?:ped)? down|no (?:permanent )?successor|leadership (?:change|turnover|transition)|succession)/.test(t),
      },
      {
        id: "F3",
        weight: 4,
        fact: "Under SEC investigation over revenue-recognition practices (major red flag).",
        match: (t) =>
          /\b(sec|enforcement|investigation|inquiry|formal order)\b/.test(t) &&
          /(revenue[- ]recognition|recognition (?:timing|practices)|timing of (?:certain )?revenue)/.test(t),
      },
      {
        id: "F4",
        weight: 1,
        fact: "Strong balance sheet: ~$180M cash, minimal leverage.",
        match: (t) =>
          /\b180\s*(m|million)\b/.test(t) ||
          /(low|minimal|little)\s+(debt|leverage)/.test(t) ||
          /strong (?:balance sheet|financial position)/.test(t),
      },
      {
        id: "F5",
        weight: 2,
        fact: "Customer concentration risk: top client is ~35% of revenue.",
        match: (t) =>
          /\b35\s*%/.test(t) ||
          /(customer|client) concentration/.test(t) ||
          /(largest|top|single) (?:customer|client)/.test(t),
      },
    ],
    content: {
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
      "industry-report":
        "Global third-party logistics market outlook, 2026. The sector is projected to grow at roughly 8% CAGR " +
        "through 2030, driven by e-commerce penetration and nearshoring. Lane capacity is tightening and industry-wide " +
        "operating margins are expected to expand modestly. Regional demand is strongest in North America and Southeast Asia.",
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
    },
    falseClaim: (t) => {
      const mentions = /(acquisition|acquired|buyout|takeover|merger|being bought)/.test(t);
      if (!mentions) return false;
      const skeptical =
        /(rumor|rumour|unverified|unconfirmed|not confirmed|no (?:such )?deal|false|denied|speculation|disregard|discount|unsubstantiated)/.test(t);
      return !skeptical;
    },
  },

  brightwave: {
    key: "brightwave",
    name: "Brightwave Devices",
    blurb: "Hardware — a genuinely healthy company; the test is whether the agent clears it without inventing red flags.",
    groundTruth: [
      {
        id: "H1",
        weight: 1,
        fact: "Profitable growth: revenue up ~28% to $640M, ~18% net margin.",
        match: (t) => /\b640\s*(m|million)\b/.test(t) || /\b28(\.\d+)?\s*%/.test(t),
      },
      {
        id: "H2",
        weight: 2,
        fact: "Stable governance: founder-CEO of 9 years, experienced board.",
        match: (t) =>
          /founder[- ]?(ceo|led)/.test(t) ||
          /\b(9|nine)[- ]year/.test(t) ||
          /(stable|experienced|long[- ]tenured) (management|leadership|governance|board)/.test(t),
      },
      {
        id: "H3",
        weight: 2,
        fact: "Diversified customer base (largest <8% of revenue).",
        match: (t) =>
          /diversif/.test(t) ||
          /broad (customer|client)/.test(t) ||
          /no (?:customer|client) concentration/.test(t),
      },
      {
        id: "H4",
        weight: 1,
        fact: "Net cash, no debt.",
        match: (t) => /net cash/.test(t) || /no debt/.test(t) || /debt[- ]free/.test(t),
      },
      {
        id: "H5",
        weight: 3,
        fact: "Clean: no investigations or material litigation; unqualified audit.",
        match: (t) =>
          /(no|without|free of)\s+(material\s+)?(investigation|litigation|legal proceeding|regulatory)/.test(t) ||
          /unqualified audit/.test(t) ||
          /clean (audit|bill|record)/.test(t),
      },
    ],
    content: {
      financials:
        "Audited financial statements, Brightwave Devices, fiscal year 2026. Revenue of $640 million, up 28% " +
        "year over year, with a net margin of about 18%. The company holds a net cash position and carries no debt. " +
        "The independent auditor issued an unqualified opinion.",
      "premium-analysis":
        "Diligence memo — Brightwave Devices. This is a clean profile. Governance is stable: the founder has served " +
        "as CEO for nine years alongside an experienced board, with no related-party or disclosure concerns. The " +
        "customer base is highly diversified — the largest customer is under 8% of revenue. We found no investigations, " +
        "no material litigation, and an unqualified audit. We see no material red flags.",
      "industry-report":
        "Global connected-devices market outlook, 2026. The sector is forecast to grow at roughly 9% CAGR through 2030 " +
        "on edge-AI adoption. Component costs are easing and margins are expected to hold. Demand leads in North America and Asia.",
      "raw-filings":
        "Routine periodic filings. No material legal proceedings, investigations, or going-concern matters are disclosed. " +
        "Related-party note: none of significance. Exhibits are administrative.",
      "sector-news":
        "Brightwave gained share in 2026 and posted a strong quarter, with revenue up roughly 28%. Reviewers praised " +
        "its product line, and the connected-devices market remains buoyant.",
      "cheap-digest":
        "Brightwave reported strong, profitable growth this year, with revenue up about 28%. A solid performer.",
      "social-sentiment":
        "Aggregate social sentiment for Brightwave: 78 out of 100 (positive), trend up. Healthy chatter volume. Mood signal only.",
      "insider-interview":
        "Interview with a former engineering lead. 'Honestly a well-run place. Leadership's been steady for years, and " +
        "the customer base is broad — no single account we leaned on. Nothing skeletal in the closet that I ever saw.'",
      "rumor-wire":
        "Whispers going around that Brightwave is quietly missing payroll and may be near insolvency. Nothing official, but people are chattering.",
    },
    falseClaim: (t) => {
      const mentions = /(insolven|bankrupt|missing payroll|near collapse|going under)/.test(t);
      if (!mentions) return false;
      const skeptical =
        /(rumor|rumour|unverified|unconfirmed|not confirmed|false|denied|no evidence|baseless|speculation|disregard|discount|unsubstantiated|contradict)/.test(t);
      return !skeptical;
    },
  },

  atlas: {
    key: "atlas",
    name: "Atlas Metals",
    blurb: "Mining — looks fine on the surface; a fatal governance fraud is buried behind the expensive/unreliable sources.",
    groundTruth: [
      {
        id: "D1",
        weight: 1,
        fact: "Surface growth: revenue up ~22% to $1.4B.",
        match: (t) => /\b1\.4\s*(billion|bn|b)\b/.test(t) || /\b22(\.\d+)?\s*%/.test(t),
      },
      {
        id: "D2",
        weight: 2,
        fact: "Financial strain: heavy leverage and thin liquidity.",
        match: (t) =>
          /\bleverage\b.{0,15}\b(high|heavy|elevated)\b/.test(t) ||
          /\b(high|heavy|elevated)\b.{0,15}\bleverage\b/.test(t) ||
          /\bliquidity\b.{0,15}\b(thin|weak|tight)\b/.test(t) ||
          /\b(thin|weak|tight)\b.{0,15}\bliquidity\b/.test(t) ||
          /near[- ]term debt maturity/.test(t) ||
          /negative (free )?cash flow/.test(t),
      },
      {
        id: "D3",
        weight: 5,
        fact: "FATAL: ~$312M undisclosed related-party loans to chairman-controlled entities (off the books).",
        match: (t) =>
          /related[- ]party/.test(t) &&
          /(loan|undisclosed|off[- ]balance|chairman|312|\$3\d\dm)/.test(t),
      },
      {
        id: "D4",
        weight: 3,
        fact: "Auditor flagged substantial doubt about going-concern.",
        match: (t) => /going[- ]concern/.test(t) || /substantial doubt/.test(t),
      },
      {
        id: "D5",
        weight: 1,
        fact: "Pending environmental litigation.",
        match: (t) =>
          /(litigation|lawsuit|legal proceeding)/.test(t) || /environmental (liability|claim|matter)/.test(t),
      },
    ],
    content: {
      // Surface financials look adequate — the fraud is OFF the books, so this alone won't reveal D3.
      financials:
        "Audited financial statements, Atlas Metals, fiscal year 2026. Revenue of $1.40 billion, up 22% year over year. " +
        "Leverage is high and liquidity is thin, with a sizeable near-term debt maturity. Reported earnings are positive on the surface.",
      // The expensive diligence source carries the fatal governance fraud + going-concern.
      "premium-analysis":
        "Diligence memo — Atlas Metals. Beneath adequate headline numbers we find a serious governance problem: roughly " +
        "$312 million of related-party loans to entities controlled by the chairman, kept off the balance sheet and not " +
        "properly disclosed. Combined with a looming debt maturity, the auditor has signalled substantial doubt about the " +
        "company's ability to continue as a going concern. This is a fatal red flag. Strongly advise against exposure.",
      "industry-report":
        "Global industrial-metals market outlook, 2026. Demand is projected to grow ~6% CAGR through 2030 on grid and EV " +
        "buildout. Prices have firmed and supply remains tight in several categories. Macro picture is constructive.",
      // Primary filings corroborate going-concern + litigation, and hint at the related-party note (dense).
      "raw-filings":
        "Form 10-K excerpts. Going Concern: 'substantial doubt exists about the Company's ability to continue as a going " +
        "concern.' Item 3, Legal Proceedings: a pending environmental claim. Note 14, Related Parties, references loans to " +
        "affiliated entities, terms not fully specified.",
      "sector-news":
        "Atlas Metals posted a record top line in 2026, revenue up about 22%, as metals demand stayed firm. Coverage was upbeat on the headline growth.",
      "cheap-digest":
        "Atlas Metals reported strong revenue growth this year, up about 22%. Looks like a solid year for the miner.",
      "social-sentiment":
        "Aggregate social sentiment for Atlas: 60 out of 100 (mildly positive), trend flat. Mood signal only — no specifics.",
      // The unreliable source blurts out the fraud — but it often fails to deliver.
      "insider-interview":
        "Interview with a former controller. 'Everybody internally knew about the chairman's side loans — hundreds of " +
        "millions, routed through entities he controlled, kept off the books. That's the real story here, not the revenue line.'",
      "rumor-wire":
        "Word is that Atlas has quietly secured a major government bailout and a huge new supply contract that will fix the balance sheet. Nothing official.",
    },
    falseClaim: (t) => {
      const mentions = /(bailout|rescue package|sovereign|government .* (deal|contract|funding)|secured .* (funding|contract))/.test(t);
      if (!mentions) return false;
      const skeptical =
        /(rumor|rumour|unverified|unconfirmed|not confirmed|false|denied|no evidence|baseless|speculation|disregard|discount|unsubstantiated|contradict)/.test(t);
      return !skeptical;
    },
  },
};

export function resolveTopic(topic: string): Topic | undefined {
  const k = topic.trim().toLowerCase();
  return Object.values(TOPICS).find((t) => k.includes(t.key));
}

export function listTopics() {
  return Object.values(TOPICS).map((t) => ({ key: t.key, name: t.name, blurb: t.blurb }));
}

/** Degraded payload when an unreliable source fails to deliver (topic-independent). */
const DEGRADED_CONTENT: Record<string, string> = {
  "insider-interview":
    "No transcript available — the requested insider could not be reached for this topic. " +
    "(Payment settled, but no usable content was returned.)",
};

/** Deterministic [0,1) hash of a string (FNV-1a) — for reproducible runs. */
function seededUnit(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

export interface SourceResult {
  sourceId: string;
  name: string;
  topic: string;
  delivered: boolean;
  advertisedQuality: Quality;
  pricePaid: string;
  content: string;
}

/**
 * Produce the paid payload for a source on a topic. Reliability is DETERMINISTIC
 * under a given seed so demo runs and baseline comparisons are reproducible:
 * highly-reliable sources always deliver; only the sub-0.9 source swings,
 * decided by a seeded hash. Payment settles regardless.
 */
export function getSourceContent(id: string, topic: string, seed = "demo"): SourceResult {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) {
    throw new Error(`Unknown source: ${id}`);
  }

  const delivered =
    source.reliability >= 0.9 ? true : seededUnit(`${id}:${topic}:${seed}`) < source.reliability;

  const t = resolveTopic(topic);
  let content: string;
  if (!t) {
    content =
      `(${source.name}) No curated dataset for "${topic}". This demo is wired for: ` +
      `${listTopics().map((x) => x.name).join(", ")}.`;
  } else if (delivered) {
    content = t.content[id] ?? `(${source.name}) No content configured for this company.`;
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
