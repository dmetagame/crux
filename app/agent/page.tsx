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

const BUDGET = 0.05;

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
  const [topics, setTopics] = useState<TopicMeta[]>([]);
  const [topic, setTopic] = useState<string>("Northwind Logistics");
  const [mode, setMode] = useState<"run" | "compare" | null>(null);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<{ label?: string; ev: AgentEvent }[]>([]);
  const [result, setResult] = useState<Done | null>(null);
  const [compare, setCompare] = useState<Record<string, Done>>({});
  const [active, setActive] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agent/topics")
      .then((r) => r.json())
      .then((d) => setTopics(d.topics))
      .catch(() => {});
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  function reset(m: "run" | "compare") {
    setMode(m);
    setRunning(true);
    setEvents([]);
    setResult(null);
    setCompare({});
    setActive(null);
    setErr(null);
  }

  async function runAgent() {
    reset("run");
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
    }
  }

  async function runCompare() {
    reset("compare");
    try {
      await streamNDJSON(`/api/agent/compare?topic=${encodeURIComponent(topic)}&budget=${BUDGET}`, (o) => {
        if (o.type === "strategy_start") setActive(o.label);
        else if (o.type === "event") setEvents((e) => [...e, { label: o.label, ev: o.event }]);
        else if (o.type === "strategy_done") setCompare((c) => ({ ...c, [o.label]: { result: o.result, score: o.score } }));
        else if (o.type === "error") setErr(o.message);
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      setActive(null);
    }
  }

  const order = ["reasoning-agent", "buy-cheapest", "buy-by-quality"];

  return (
    <div className="relative min-h-screen text-zinc-100">
      <TopoBackground />
      <div className="mx-auto max-w-5xl px-5 py-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-baseline gap-2.5">
            <h1 className="bg-gradient-to-r from-violet-200 via-violet-100 to-teal-200 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              Crux
            </h1>
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">paying research agent</span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Crux decides what information is worth buying about a company, under a strict ${BUDGET} USDC budget, and
            pays for each source with real nanopayments that settle on Arc. The spending{" "}
            <span className="text-zinc-200">judgment</span> is the product.
          </p>
        </header>

        {/* Company picker */}
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

        {/* Controls */}
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
            className="rounded-md border border-zinc-700 bg-zinc-900/55 backdrop-blur-smpx-4 py-2 text-sm font-medium hover:border-zinc-600 disabled:opacity-50"
          >
            {running && mode === "compare" ? "Comparing…" : "Compare vs naive baselines"}
          </button>
          <span className="text-xs text-zinc-500">Real USDC · Arc testnet · reproducible (seed: demo)</span>
        </div>

        {err && <div className="mt-4 rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">Error: {err}</div>}

        {/* Live activity */}
        {(events.length > 0 || running) && (
          <section className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Live activity {active && <span className="text-zinc-400">· {active}</span>}
            </h2>
            <div ref={logRef} className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/55 backdrop-blur-smp-3">
              {events.map((e, i) => (
                <EventRow key={i} label={e.label} ev={e.ev} />
              ))}
              {running && <div className="animate-pulse text-xs text-zinc-500">…thinking</div>}
            </div>
          </section>
        )}

        {/* Single-run result */}
        {mode === "run" && result && <ResultPanel done={result} />}

        {/* Comparison */}
        {mode === "compare" && Object.keys(compare).length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Comparison — {topic}</h2>
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/55 backdrop-blur-smtext-left text-zinc-400">
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

        <footer className="mt-10 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
          Payments settle on Arc testnet via Circle Gateway batching. LLM routed through the Vercel AI Gateway.
        </footer>
      </div>
    </div>
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
        <span className="text-amber-400">· DEGRADED (paid, no content)</span>
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
      <div className="md:col-span-2 rounded-lg border border-zinc-800 bg-zinc-900/55 backdrop-blur-smp-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{heading}</h3>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{result.brief || "(no brief)"}</div>
      </div>
      <div className="space-y-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 backdrop-blur-smp-4">
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
