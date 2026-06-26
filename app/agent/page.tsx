"use client";

import { useEffect, useRef, useState } from "react";
import TopoBackground from "@/components/topo-background";

// --- Types (mirror the streaming API; kept local to the client) ---
type AgentEvent =
  | { kind: "preview"; sourceId: string }
  | { kind: "purchase"; sourceId: string; price: string; delivered: boolean; rationale: string; tx?: string };

interface LedgerEntry {
  n: number;
  sourceId: string;
  price: string;
  delivered: boolean;
  rationale: string;
  tx?: string;
}
interface RunResult {
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
interface RealRunResult extends RunResult {
  subject: string;
  citations: { sourceId: string; url: string }[];
}
interface Score {
  topic: string;
  capturedFacts: { id: string; weight: number; fact: string }[];
  missedFacts: { id: string; weight: number; fact: string }[];
  weighted: number;
  maxWeighted: number;
  coverage: number;
  falseClaim: boolean;
}
interface TopicMeta {
  key: string;
  name: string;
  blurb: string;
}
type Done = { result: RunResult; score: Score };
type RealDone = { result: RealRunResult };

interface Stats {
  totalPayments: number;
  totalUsdc: number;
  avgUsdc: number;
  distinctPayers: number;
}

const BUDGET = 0.05;
const REAL_BUDGET = 0.03;

// Curated, unambiguous example subjects. Public ones should make the agent buy
// SEC EDGAR; private ones should make it skip that $0.01 spend — the visible
// judgement call.
const PUBLIC_EXAMPLES = ["Nvidia", "Coinbase", "Palantir"];
const PRIVATE_EXAMPLES = ["OpenAI", "Anthropic", "Stripe"];

async function streamNDJSON(url: string, onObj: (o: any) => void, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onObj(JSON.parse(line));
  }
  if (buf.trim()) onObj(JSON.parse(buf));
}

function pretty(id: string) {
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AgentPage() {
  const [tab, setTab] = useState<"real" | "benchmark">("real");
  const [stats, setStats] = useState<Stats | null>(null);

  // shared run state
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<{ label?: string; ev: AgentEvent }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // benchmark state
  const [topics, setTopics] = useState<TopicMeta[]>([]);
  const [topic, setTopic] = useState<string>("Northwind Logistics");
  const [mode, setMode] = useState<"run" | "compare" | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  const [compare, setCompare] = useState<Record<string, Done>>({});
  const [active, setActive] = useState<string | null>(null);

  // real state
  const [subject, setSubject] = useState<string>("Coinbase");
  const [realResult, setRealResult] = useState<RealDone | null>(null);

  function refreshStats() {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }

  useEffect(() => {
    fetch("/api/agent/topics")
      .then((r) => r.json())
      .then((d) => setTopics(d.topics))
      .catch(() => {});
    refreshStats();
    const id = setInterval(refreshStats, 8000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  function resetRun() {
    setRunning(true);
    setEvents([]);
    setErr(null);
  }

  async function runRealAgent(subj: string) {
    if (running) return;
    setSubject(subj);
    resetRun();
    setRealResult(null);
    try {
      await streamNDJSON(`/api/agent/real?subject=${encodeURIComponent(subj)}&budget=${REAL_BUDGET}`, (o) => {
        if (o.type === "event") setEvents((e) => [...e, { ev: o.event }]);
        else if (o.type === "done") setRealResult({ result: o.result });
        else if (o.type === "error") setErr(o.message);
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      refreshStats();
    }
  }

  async function runAgent() {
    setMode("run");
    resetRun();
    setResult(null);
    setCompare({});
    setActive(null);
    try {
      await streamNDJSON(`/api/agent/run?topic=${encodeURIComponent(topic)}&budget=${BUDGET}`, (o) => {
        if (o.type === "event") setEvents((e) => [...e, { ev: o.event }]);
        else if (o.type === "done") setResult({ result: o.result, score: o.score });
        else if (o.type === "error") setErr(o.message);
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      refreshStats();
    }
  }

  async function runCompare() {
    setMode("compare");
    resetRun();
    setResult(null);
    setCompare({});
    setActive(null);
    const enc = encodeURIComponent(topic);
    const steps = [
      { label: "reasoning-agent", url: `/api/agent/run?topic=${enc}&budget=${BUDGET}` },
      { label: "buy-cheapest", url: `/api/agent/baseline?strategy=cheapest&topic=${enc}&budget=${BUDGET}` },
      { label: "buy-by-quality", url: `/api/agent/baseline?strategy=quality&topic=${enc}&budget=${BUDGET}` },
    ];
    try {
      for (const s of steps) {
        setActive(s.label);
        await streamNDJSON(s.url, (o) => {
          if (o.type === "event") setEvents((e) => [...e, { label: s.label, ev: o.event }]);
          else if (o.type === "done") setCompare((c) => ({ ...c, [s.label]: { result: o.result, score: o.score } }));
          else if (o.type === "error") setErr(o.message);
        });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      setActive(null);
      refreshStats();
    }
  }

  const order = ["reasoning-agent", "buy-cheapest", "buy-by-quality"];

  return (
    <div className="relative min-h-screen text-zinc-100">
      <TopoBackground />
      <div className="mx-auto max-w-5xl px-5 py-10">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-baseline gap-2.5">
            <h1 className="bg-gradient-to-r from-violet-200 via-violet-100 to-teal-200 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              Crux
            </h1>
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">paying research agent</span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Crux decides what information is worth buying about a subject, under a strict USDC budget, and pays for each
            source with real nanopayments that settle on Arc. The spending{" "}
            <span className="text-zinc-200">judgment</span> is the product.
          </p>
        </header>

        {/* Live traction counter */}
        <StatsBar stats={stats} />

        {/* Tabs */}
        <div className="mt-6 flex gap-1 border-b border-zinc-800">
          <TabButton active={tab === "real"} onClick={() => setTab("real")} disabled={running}>
            Research a real subject
          </TabButton>
          <TabButton active={tab === "benchmark"} onClick={() => setTab("benchmark")} disabled={running}>
            Benchmark (scored vs baselines)
          </TabButton>
        </div>

        {err && <div className="mt-4 rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">Error: {err}</div>}

        {/* ============================= REAL TAB ============================= */}
        {tab === "real" && (
          <div className="mt-5">
            <p className="mb-3 max-w-2xl text-sm text-zinc-400">
              Name any company, project, or person. Crux shops live paid sources — Wikipedia, Wikidata, SEC EDGAR, Hacker
              News — and buys only what fits. Watch the call it makes on the{" "}
              <span className="text-zinc-200">$0.01 SEC filing</span>: it buys it for a public company and skips it for a
              private one.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runRealAgent(subject)}
                disabled={running}
                placeholder="e.g. Nvidia, Stripe, Palantir…"
                className="w-64 rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500 disabled:opacity-50"
              />
              <button
                onClick={() => runRealAgent(subject)}
                disabled={running || !subject.trim()}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {running ? "Researching…" : "Research"}
              </button>
              <span className="text-xs text-zinc-500">${REAL_BUDGET} USDC budget · Arc testnet · live data</span>
            </div>

            <div className="mt-3 space-y-1.5">
              <ChipRow label="Public" hint="→ should buy SEC filings" items={PUBLIC_EXAMPLES} onPick={runRealAgent} disabled={running} />
              <ChipRow label="Private" hint="→ should skip them" items={PRIVATE_EXAMPLES} onPick={runRealAgent} disabled={running} />
            </div>

            <LiveActivity events={events} running={running} logRef={logRef} />
            {realResult && <RealResultPanel done={realResult} />}
          </div>
        )}

        {/* =========================== BENCHMARK TAB =========================== */}
        {tab === "benchmark" && (
          <div className="mt-5">
            <p className="mb-3 max-w-2xl text-sm text-zinc-400">
              A controlled marketplace with a known answer key, built so no fixed heuristic wins. Run the agent, or compare
              it against naive “buy-cheapest” / “buy-by-quality” baselines on the same budget.
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              {topics.map((t) => (
                <button
                  key={t.key}
                  disabled={running}
                  onClick={() => setTopic(t.name)}
                  className={`rounded-lg border p-3 text-left transition ${
                    topic === t.name
                      ? "border-violet-500 bg-violet-500/10"
                      : "border-zinc-800 bg-zinc-900/55 backdrop-blur-sm hover:border-zinc-700"
                  } disabled:opacity-50`}
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="mt-1 text-xs text-zinc-400">{t.blurb}</div>
                </button>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={runAgent}
                disabled={running}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {running && mode === "run" ? "Running…" : "Run agent"}
              </button>
              <button
                onClick={runCompare}
                disabled={running}
                className="rounded-md border border-zinc-700 bg-zinc-900/55 px-4 py-2 text-sm font-medium backdrop-blur-sm hover:border-zinc-600 disabled:opacity-50"
              >
                {running && mode === "compare" ? "Comparing…" : "Compare vs naive baselines"}
              </button>
              <span className="text-xs text-zinc-500">Real USDC · Arc testnet · reproducible (seed: demo)</span>
            </div>

            <LiveActivity events={events} running={running} logRef={logRef} active={active} />

            {mode === "run" && result && <ResultPanel done={result} />}

            {mode === "compare" && Object.keys(compare).length > 0 && (
              <section className="mt-6">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Comparison — {topic}</h2>
                <div className="overflow-hidden rounded-lg border border-zinc-800">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-900/55 text-left text-zinc-400 backdrop-blur-sm">
                      <tr>
                        <th className="px-3 py-2 font-medium">Strategy</th>
                        <th className="px-3 py-2 font-medium">Spent</th>
                        <th className="px-3 py-2 font-medium">Buys</th>
                        <th className="px-3 py-2 font-medium">Coverage</th>
                        <th className="px-3 py-2 font-medium">False claim</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order
                        .filter((k) => compare[k])
                        .map((k) => {
                          const d = compare[k];
                          const isAgent = k === "reasoning-agent";
                          return (
                            <tr key={k} className={`border-t border-zinc-800 ${isAgent ? "bg-emerald-500/5" : ""}`}>
                              <td className="px-3 py-2 font-medium">{isAgent ? "Reasoning agent" : pretty(k)}</td>
                              <td className="px-3 py-2 tabular-nums">${d.result.spent}</td>
                              <td className="px-3 py-2 tabular-nums">{d.result.ledger.length}</td>
                              <td className="px-3 py-2">
                                <span className={d.score.coverage >= 0.9 ? "text-emerald-400" : "text-amber-400"}>
                                  {d.score.weighted}/{d.score.maxWeighted} ({Math.round(d.score.coverage * 100)}%)
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {d.score.falseClaim ? (
                                  <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-400">YES — rumor</span>
                                ) : (
                                  <span className="text-zinc-500">no</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                {compare["reasoning-agent"] && (
                  <p className="mt-3 text-sm text-zinc-400">
                    The reasoning agent captured{" "}
                    <span className="text-emerald-400">
                      {compare["reasoning-agent"].score.weighted}/{compare["reasoning-agent"].score.maxWeighted}
                    </span>{" "}
                    with no false claim — previewing past the macro trap and skipping the rumor the heuristics swallowed.
                  </p>
                )}
                <ResultPanel done={compare["reasoning-agent"]} heading="Agent's brief" />
              </section>
            )}
          </div>
        )}

        <footer className="mt-10 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
          Payments settle on Arc testnet via Circle Gateway batching. LLM routed through the Vercel AI Gateway.
        </footer>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
        active ? "border-violet-400 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

function StatsBar({ stats }: { stats: Stats | null }) {
  const cells = [
    { label: "autonomous payments", value: stats ? stats.totalPayments.toLocaleString() : "—" },
    { label: "test-USDC settled", value: stats ? `$${stats.totalUsdc.toFixed(3)}` : "—" },
    { label: "avg tx size", value: stats ? `$${stats.avgUsdc.toFixed(4)}` : "—" },
    { label: "distinct payers", value: stats ? stats.distinctPayers.toLocaleString() : "—" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="rounded-lg border border-zinc-800 bg-zinc-900/55 px-3 py-2 backdrop-blur-sm">
          <div className="text-lg font-semibold tabular-nums text-teal-300">{c.value}</div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function ChipRow({ label, hint, items, onPick, disabled }: { label: string; hint: string; items: string[]; onPick: (s: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 text-xs font-medium text-zinc-500">{label}</span>
      {items.map((s) => (
        <button
          key={s}
          onClick={() => onPick(s)}
          disabled={disabled}
          className="rounded-full border border-zinc-700 bg-zinc-900/55 px-3 py-1 text-xs text-zinc-300 backdrop-blur-sm hover:border-violet-500 hover:text-zinc-100 disabled:opacity-50"
        >
          {s}
        </button>
      ))}
      <span className="text-[11px] text-zinc-600">{hint}</span>
    </div>
  );
}

function LiveActivity({
  events,
  running,
  logRef,
  active,
}: {
  events: { label?: string; ev: AgentEvent }[];
  running: boolean;
  logRef: React.RefObject<HTMLDivElement | null>;
  active?: string | null;
}) {
  if (events.length === 0 && !running) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Live activity {active && <span className="text-zinc-400">· {active}</span>}
      </h2>
      <div ref={logRef} className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/55 p-3 backdrop-blur-sm">
        {events.map((e, i) => (
          <EventRow key={i} label={e.label} ev={e.ev} />
        ))}
        {running && <div className="animate-pulse text-xs text-zinc-500">…thinking</div>}
      </div>
    </section>
  );
}

function EventRow({ label, ev }: { label?: string; ev: AgentEvent }) {
  if (ev.kind === "preview") {
    return (
      <div className="text-xs text-zinc-500">
        {label && <span className="text-zinc-600">[{label}] </span>}
        <span className="text-sky-400">previewed</span> {pretty(ev.sourceId)} <span className="text-zinc-600">(free)</span>
      </div>
    );
  }
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5 text-xs">
      {label && <span className="text-zinc-600">[{label}] </span>}
      <span className="font-medium text-emerald-400">paid {ev.price}</span> for{" "}
      <span className="text-zinc-200">{pretty(ev.sourceId)}</span>{" "}
      {ev.delivered ? (
        <span className="text-zinc-500">· settled on Arc</span>
      ) : (
        <span className="text-amber-400">· paid, no usable data</span>
      )}
      {ev.tx && <span className="ml-1 text-zinc-600">· batch {ev.tx.slice(0, 8)}</span>}
      {ev.rationale && <div className="mt-0.5 text-zinc-400">“{ev.rationale}”</div>}
    </div>
  );
}

function ResultPanel({ done, heading = "Brief" }: { done?: Done; heading?: string }) {
  if (!done) return null;
  const { result, score } = done;
  return (
    <section className="mt-6 grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-4 backdrop-blur-sm md:col-span-2">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{heading}</h3>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{result.brief || "(no brief)"}</div>
      </div>
      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-4 backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Score vs ground truth</h3>
          <div className="text-2xl font-semibold text-emerald-400">{Math.round(score.coverage * 100)}%</div>
          <div className="text-xs text-zinc-400">
            {score.weighted}/{score.maxWeighted} weighted facts · ${result.spent} spent
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {score.capturedFacts.map((f) => (
              <span key={f.id} className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-400">{f.id}</span>
            ))}
            {score.missedFacts.map((f) => (
              <span key={f.id} className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-xs text-zinc-500 line-through">{f.id}</span>
            ))}
          </div>
          <div className="mt-2 text-xs">
            False claim:{" "}
            {score.falseClaim ? (
              <span className="font-medium text-red-400">YES — ingested the rumor</span>
            ) : (
              <span className="text-emerald-400">no</span>
            )}
          </div>
          <div className="mt-1 text-xs text-zinc-600">
            {result.previews} previews · {result.ledger.length} buys · {result.steps} steps · {result.tokens} tokens
          </div>
        </div>
      </div>
    </section>
  );
}

function RealResultPanel({ done }: { done: RealDone }) {
  const { result } = done;
  const bought = new Set(result.ledger.map((l) => l.sourceId));
  const skipped = ["wikipedia", "wikidata", "edgar", "news"].filter((s) => !bought.has(s));
  return (
    <section className="mt-6 grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-4 backdrop-blur-sm md:col-span-2">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Brief — {result.subject}</h3>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{result.brief || "(no brief)"}</div>
        {result.citations?.length > 0 && (
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">Citations</div>
            <div className="flex flex-wrap gap-2">
              {result.citations.map((c) => (
                <a
                  key={c.sourceId}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300 hover:bg-sky-500/20"
                >
                  {pretty(c.sourceId)} ↗
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-4 backdrop-blur-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Spend decision</h3>
          <div className="text-2xl font-semibold text-teal-300">${result.spent.toFixed(3)}</div>
          <div className="text-xs text-zinc-400">of ${REAL_BUDGET} budget · {result.ledger.length} sources bought</div>
          <div className="mt-3 space-y-1">
            {result.ledger.map((l) => (
              <div key={l.n} className="text-xs">
                <span className="text-emerald-400">✓ {pretty(l.sourceId)}</span>{" "}
                <span className="text-zinc-600">{l.price}</span>
                {!l.delivered && <span className="text-amber-400"> · no data</span>}
              </div>
            ))}
            {skipped.map((s) => (
              <div key={s} className="text-xs text-zinc-600">
                ✗ {pretty(s)} <span className="text-zinc-700">· skipped</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-zinc-600">
            {result.previews} previews · {result.steps} steps · {result.tokens} tokens
          </div>
        </div>
      </div>
    </section>
  );
}
