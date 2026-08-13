/**
 * REAL research marketplace — live public data behind x402 paywalls on Arc.
 *
 * The Benchmark marketplace (./marketplace.ts) uses curated companies with
 * ground truth, so we can SCORE the agent objectively. This module is the other
 * half of the hybrid: the agent researches a REAL subject the user types, and
 * each source fetches live public data (Wikipedia, Wikidata, SEC EDGAR, Hacker
 * News). No ground truth — the value is the real, citable information itself.
 *
 * The spend decision stays genuinely hard: SEC EDGAR is worth $0.01 for a U.S.
 * public company but wasteful for a private startup or a person; Wikidata
 * overlaps Wikipedia; news is strong for current/tech subjects and thin for
 * historical ones. Only judgement about WHAT THE SUBJECT IS spends well.
 *
 * Every fetch is defensive: network/parse failures return delivered:false with
 * an explanation. Payment settles regardless (that risk is the agent's, exactly
 * as on a real paid API).
 */

import {
  evidenceMatchesSubject,
  subjectMatchesCandidate,
} from "./subject-relevance.ts";

export interface RealSourceMeta {
  id: string;
  name: string;
  category: string;
  price: string; // x402 price string for withGateway
  priceUsdc: number;
  /** Static, free preview: what this source returns and when it's worth buying. */
  preview: string;
}

export const REAL_SOURCES: RealSourceMeta[] = [
  {
    id: "wikipedia",
    name: "Wikipedia Overview",
    category: "encyclopedia",
    price: "$0.002",
    priceUsdc: 0.002,
    preview:
      "A prose summary of the subject from Wikipedia. Good general grounding for almost any notable company, " +
      "person, or topic. Weak or empty for very new/obscure subjects.",
  },
  {
    id: "wikidata",
    name: "Wikidata Structured Facts",
    category: "structured-data",
    price: "$0.001",
    priceUsdc: 0.001,
    preview:
      "Structured identity facts (description, founding date, employee count, notability) from Wikidata. " +
      "Cheap. Overlaps heavily with the Wikipedia overview — rarely worth buying BOTH for the same subject.",
  },
  {
    id: "edgar",
    name: "SEC EDGAR Filings",
    category: "regulatory-primary",
    price: "$0.01",
    priceUsdc: 0.01,
    preview:
      "Primary U.S. regulatory filings (10-K, 10-Q, 8-K history) for the registrant. The single most authoritative " +
      "source for a U.S. PUBLIC company — and the most expensive. Returns nothing for private companies, non-U.S. " +
      "entities, people, or topics, so only buy it when the subject is plausibly a U.S.-listed company.",
  },
  {
    id: "news",
    name: "Hacker News Discussion",
    category: "news-sentiment",
    price: "$0.003",
    priceUsdc: 0.003,
    preview:
      "Recent Hacker News stories and discussion mentioning the subject, with points and dates. Strong for tech " +
      "companies, software, and current events; thin for non-tech or historical subjects.",
  },
];

export interface RealSourceResult {
  sourceId: string;
  name: string;
  subject: string;
  delivered: boolean;
  content: string;
  /** Canonical public URL the brief can cite. */
  citationUrl: string | null;
}

// SEC's fair-access policy requires a descriptive User-Agent with a contact; a
// bare UA gets 403'd from datacenter IPs. Used for every outbound data call.
const UA = "Crux-Research/1.0 (dmetagame@users.noreply.github.com)";
const DEFAULT_SOURCE_CALL_TIMEOUT_MS = 6_000;
const MAX_FETCH_ATTEMPT_MS = 3_000;

type SourceFetchContext = {
  deadlineAt: number;
  signal: AbortSignal;
};

async function fetchOnce(url: string, context: SourceFetchContext, init?: RequestInit): Promise<any> {
  const remaining = remainingSourceTime(context);
  const attemptSignal = AbortSignal.timeout(Math.min(MAX_FETCH_ATTEMPT_MS, remaining));
  const signals = [context.signal, attemptSignal];
  if (init?.signal) signals.push(init.signal);
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.any(signals),
    headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/** One retry with short backoff — public APIs occasionally throttle a single hit. */
async function fetchJson(url: string, context: SourceFetchContext, init?: RequestInit): Promise<any> {
  try {
    return await fetchOnce(url, context, init);
  } catch (err) {
    if (context.signal.aborted || remainingSourceTime(context, false) < 1_000) {
      throw sourceFetchError(err, context);
    }
    await waitForRetry(context);
    try {
      return await fetchOnce(url, context, init);
    } catch (retryErr) {
      throw sourceFetchError(retryErr, context);
    }
  }
}

function sourceCallTimeoutMs() {
  const configured = Number.parseInt(process.env.CRUX_REAL_SOURCE_TIMEOUT_MS ?? "", 10);
  if (!Number.isFinite(configured)) return DEFAULT_SOURCE_CALL_TIMEOUT_MS;
  return Math.min(25_000, Math.max(3_000, configured));
}

function remainingSourceTime(context: SourceFetchContext, throwIfExpired = true) {
  const remaining = context.deadlineAt - Date.now();
  if (remaining > 0) return remaining;
  if (!throwIfExpired) return 0;
  throw new Error("source call deadline exceeded");
}

async function waitForRetry(context: SourceFetchContext) {
  const delay = Math.min(600, Math.max(0, remainingSourceTime(context) - 250));
  if (delay <= 0) throw new Error("source call deadline exceeded");
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", onAbort);
      reject(new Error("source call deadline exceeded"));
    };
    const timer = setTimeout(() => {
      context.signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    context.signal.addEventListener("abort", onAbort, { once: true });
  });
}

function sourceFetchError(err: unknown, context: SourceFetchContext) {
  if (context.signal.aborted || Date.now() >= context.deadlineAt) {
    return new Error("source call deadline exceeded");
  }
  return err instanceof Error ? err : new Error(String(err));
}

// --- Wikipedia ------------------------------------------------------------
async function fetchWikipedia(subject: string, context: SourceFetchContext): Promise<RealSourceResult> {
  const base = { sourceId: "wikipedia", name: "Wikipedia Overview", subject } as const;
  try {
    // Resolve the canonical article title first, so "Stripe" → "Stripe, Inc." and
    // we don't land on a disambiguation page or the wrong same-named entity.
    let title = subject.trim();
    try {
      const s = await fetchJson(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          subject,
        )}&srlimit=1&format=json`,
        context,
      );
      if (s?.query?.search?.[0]?.title) title = s.query.search[0].title;
    } catch {
      /* fall back to the raw subject as the title */
    }
    const data = await fetchJson(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, "_"))}`,
      context,
    );
    if (data?.type === "disambiguation" || !data?.extract) {
      return { ...base, delivered: false, content: `No clean Wikipedia article for "${subject}".`, citationUrl: null };
    }
    if (!subjectMatchesCandidate(subject, String(data.title ?? ""))) {
      return {
        ...base,
        delivered: false,
        content: `Wikipedia's closest result, "${data.title}", does not match the literal subject "${subject}".`,
        citationUrl: null,
      };
    }
    const url = data?.content_urls?.desktop?.page ?? null;
    const desc = data.description ? ` (${data.description})` : "";
    return {
      ...base,
      delivered: true,
      content: `Wikipedia — ${data.title}${desc}: ${data.extract}`,
      citationUrl: url,
    };
  } catch (err) {
    return { ...base, delivered: false, content: `Wikipedia lookup failed: ${sourceFetchError(err, context).message}`, citationUrl: null };
  }
}

// --- Wikidata -------------------------------------------------------------
// Only human-readable, non-entity-valued props — entity values (P159 HQ, P452
// industry) would surface as raw QIDs, and the description already conveys them.
const WD_PROPS: Record<string, string> = {
  P571: "founded",
  P1128: "employees",
};

async function fetchWikidata(subject: string, context: SourceFetchContext): Promise<RealSourceResult> {
  const base = { sourceId: "wikidata", name: "Wikidata Structured Facts", subject } as const;
  try {
    const search = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
        subject,
      )}&language=en&format=json&limit=1`,
      context,
    );
    const hit = search?.search?.[0];
    if (!hit) return { ...base, delivered: false, content: `No Wikidata entity for "${subject}".`, citationUrl: null };
    if (!subjectMatchesCandidate(subject, String(hit.label ?? hit.match?.text ?? ""))) {
      return {
        ...base,
        delivered: false,
        content: `Wikidata's closest entity, "${hit.label ?? "unknown"}", does not match the literal subject "${subject}".`,
        citationUrl: null,
      };
    }

    const ent = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hit.id}&props=claims|descriptions|sitelinks&format=json`,
      context,
    );
    const e = ent?.entities?.[hit.id];
    const claims = e?.claims ?? {};
    const facts: string[] = [];
    for (const [pid, label] of Object.entries(WD_PROPS)) {
      const c = claims[pid]?.[0]?.mainsnak?.datavalue?.value;
      if (!c) continue;
      if (pid === "P571" && c.time) {
        // "+2010-00-00T..." → "2010"; "+1976-04-01T..." → "1976-04-01"
        const m = String(c.time).match(/^\+?(\d{4})-(\d{2})-(\d{2})/);
        if (m) facts.push(`${label}: ${m[2] === "00" ? m[1] : `${m[1]}-${m[2]}-${m[3]}`}`);
      } else if (pid === "P1128" && c.amount) {
        facts.push(`${label}: ${String(c.amount).replace(/^\+/, "")}`);
      }
    }
    const sitelinks = e?.sitelinks ? Object.keys(e.sitelinks).length : 0;
    const factStr = facts.length ? ` Structured facts — ${facts.join("; ")}.` : "";
    return {
      ...base,
      delivered: true,
      content: `Wikidata — ${hit.label} (${hit.description ?? "no description"}).${factStr} Notability: present in ${sitelinks} Wikimedia sites.`,
      citationUrl: hit.concepturi ?? `https://www.wikidata.org/wiki/${hit.id}`,
    };
  } catch (err) {
    return { ...base, delivered: false, content: `Wikidata lookup failed: ${sourceFetchError(err, context).message}`, citationUrl: null };
  }
}

// --- SEC EDGAR ------------------------------------------------------------
// The CIK/ticker map is BUNDLED (lib/sec-tickers.json) rather than fetched:
// SEC rate-limits/blocks datacenter IPs ("Request Rate Threshold Exceeded"),
// so a live fetch is unreliable from Vercel. Bundling makes the decisive
// public/private signal deterministic and zero-latency. Refresh the JSON
// periodically with the build script in scripts/. The filings list is still
// pulled live (best-effort enrichment) inside fetchEdgar.
import secTickers from "./sec-tickers.json" with { type: "json" };

const TICKER_MAP = (secTickers.data as [string, string, string][]).map(([cik, ticker, title]) => ({
  cik,
  ticker: ticker.toLowerCase(),
  title: title.toLowerCase(), // for matching
  display: title, // original case for output
}));

function loadTickers() {
  return TICKER_MAP;
}

async function fetchEdgar(subject: string, context: SourceFetchContext): Promise<RealSourceResult> {
  const base = { sourceId: "edgar", name: "SEC EDGAR Filings", subject } as const;
  try {
    const q = subject.trim().toLowerCase();
    const tickers = await loadTickers();
    const tickerMatch = tickers.find((ticker) => ticker.ticker === q);
    const exactTitleMatch = tickers.find((ticker) => ticker.title === q);
    const candidateMatches = tickerMatch || exactTitleMatch
      ? []
      : tickers.filter((ticker) => subjectMatchesCandidate(subject, ticker.display));
    const match = tickerMatch ?? exactTitleMatch ?? (candidateMatches.length === 1 ? candidateMatches[0] : null);
    if (!match) {
      return {
        ...base,
        delivered: false,
        content: `No SEC registrant matches "${subject}" — not a U.S. public company (or filed under a different legal name). No regulatory filings to report.`,
        citationUrl: null,
      };
    }
    // The decisive signal (is this a U.S. public registrant?) comes from the
    // ticker match alone, so EDGAR stays useful even if the heavier filings
    // call is throttled. The filings list is best-effort enrichment.
    let name = match.display;
    let sic = "";
    let filings = "";
    try {
      const sub = await fetchJson(`https://data.sec.gov/submissions/CIK${match.cik}.json`, context);
      if (sub?.name) name = sub.name;
      if (sub?.sicDescription) sic = ` SIC: ${sub.sicDescription}.`;
      const recent = sub?.filings?.recent;
      if (recent?.form) {
        const out: string[] = [];
        const n = Math.min(recent.form.length, 8);
        for (let i = 0; i < n; i++) out.push(`${recent.filingDate[i]} ${recent.form[i]}`);
        if (out.length) filings = ` Recent filings: ${out.join("; ")}.`;
      }
    } catch {
      /* filings enrichment unavailable — identity from the ticker map still stands */
    }
    return {
      ...base,
      delivered: true,
      content:
        `SEC EDGAR — ${name} (CIK ${match.cik}, ticker ${match.ticker.toUpperCase()}).${sic}${filings} ` +
        `This confirms an active U.S. public registrant filing audited disclosures (10-K/10-Q/8-K) with the SEC.`,
      citationUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${match.cik}&type=10-K`,
    };
  } catch (err) {
    return { ...base, delivered: false, content: `EDGAR lookup failed: ${sourceFetchError(err, context).message}`, citationUrl: null };
  }
}

// --- Hacker News ----------------------------------------------------------
async function fetchNews(subject: string, context: SourceFetchContext): Promise<RealSourceResult> {
  const base = { sourceId: "news", name: "Hacker News Discussion", subject } as const;
  try {
    const data = await fetchJson(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(subject)}&tags=story&hitsPerPage=5`,
      context,
    );
    const hits = (data?.hits ?? []).filter(
      (h: any) => h.title && evidenceMatchesSubject(subject, `${h.title} ${h.url ?? ""}`),
    );
    if (!hits.length) return { ...base, delivered: false, content: `No Hacker News discussion mentions "${subject}".`, citationUrl: null };
    const lines = hits.map(
      (h: any) => `• "${h.title}" (${h.points ?? 0} pts, ${String(h.created_at).slice(0, 10)})`,
    );
    return {
      ...base,
      delivered: true,
      content: `Hacker News — recent discussion of "${subject}":\n${lines.join("\n")}`,
      citationUrl: `https://hn.algolia.com/?q=${encodeURIComponent(subject)}`,
    };
  } catch (err) {
    return { ...base, delivered: false, content: `Hacker News lookup failed: ${sourceFetchError(err, context).message}`, citationUrl: null };
  }
}

const FETCHERS: Record<string, (s: string, context: SourceFetchContext) => Promise<RealSourceResult>> = {
  wikipedia: fetchWikipedia,
  wikidata: fetchWikidata,
  edgar: fetchEdgar,
  news: fetchNews,
};

/** Fetch the live paid payload for a real source + subject. */
export async function fetchRealSource(id: string, subject: string): Promise<RealSourceResult> {
  const fetcher = FETCHERS[id];
  if (!fetcher) throw new Error(`Unknown real source: ${id}`);
  const controller = new AbortController();
  const timeoutMs = sourceCallTimeoutMs();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(subject, {
      deadlineAt: Date.now() + timeoutMs,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Public catalog view — metadata only, no live calls. */
export function realCatalog() {
  return REAL_SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    price: s.price,
    priceUsdc: s.priceUsdc,
    purchaseUrl: `/api/real/${s.id}`,
  }));
}

export function getRealPreview(id: string): { id: string; preview: string | null } {
  const s = REAL_SOURCES.find((x) => x.id === id);
  return { id, preview: s?.preview ?? null };
}
