/**
 * Refreshes lib/sec-tickers.json from the SEC's canonical company_tickers.json.
 * Run occasionally (the map changes slowly): `npm run refresh-tickers`.
 * The map is bundled rather than fetched at runtime because SEC rate-limits and
 * blocks datacenter IPs, which makes a live fetch from Vercel unreliable.
 */
import { writeFileSync } from "node:fs";

const UA = "Crux-Research/1.0 (dmetagame@users.noreply.github.com)";
const res = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA } });
if (!res.ok) throw new Error(`SEC returned HTTP ${res.status}`);
const raw = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;

const data = Object.values(raw).map((r) => [String(r.cik_str).padStart(10, "0"), String(r.ticker), String(r.title)]);
writeFileSync("lib/sec-tickers.json", JSON.stringify({ generated: new Date().toISOString().slice(0, 10), data }));
console.log(`Wrote lib/sec-tickers.json — ${data.length} registrants.`);
