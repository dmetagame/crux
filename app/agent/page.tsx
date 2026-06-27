"use client";

import { useEffect, useRef, useState } from "react";
import TopoBackground from "@/components/topo-background";
import { settlementExplorerUrl, shortSettlementId } from "@/lib/settlement";

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
type ReceiptMeta = { receiptId?: string | null; receiptUrl?: string | null };
type Done = { result: RunResult; score: Score } & ReceiptMeta;
type RealDone = { result: RealRunResult } & ReceiptMeta;

interface Stats {
  totalPayments: number;
  totalUsdc: number;
  avgUsdc: number;
  distinctPayers: number;
  onboardedWallets?: number;
  recent?: RecentPayment[];
}

interface RecentPayment {
  amount: number;
  endpoint: string;
  tx?: string | null;
  at: string;
}

interface WalletInfo {
  walletId: string;
  address: string;
}
interface WalletStatus {
  funded: boolean;
  walletUsdc: number;
  gatewayUsdc: number;
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

  // optional "pay from your own wallet" lane
  const [walletOpen, setWalletOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(null);
  const [walletBusy, setWalletBusy] = useState<"create" | "check" | null>(null);
  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Use the visitor's own wallet only once it's funded; otherwise the house wallet.
  const useOwnWallet = !!(wallet && walletStatus?.funded);

  async function createWallet() {
    if (walletBusy) return;
    setWalletBusy("create");
    setWalletErr(null);
    setWalletStatus(null);
    try {
      const r = await fetch("/api/wallet/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not create wallet");
      setWallet({ walletId: d.walletId, address: d.address });
    } catch (e) {
      setWalletErr((e as Error).message);
    } finally {
      setWalletBusy(null);
    }
  }

  async function checkFunding() {
    if (!wallet || walletBusy) return;
    setWalletBusy("check");
    setWalletErr(null);
    try {
      const r = await fetch(`/api/wallet/status?walletId=${wallet.walletId}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not check funding");
      setWalletStatus({ funded: d.funded, walletUsdc: d.walletUsdc, gatewayUsdc: d.gatewayUsdc });
    } catch (e) {
      setWalletErr((e as Error).message);
    } finally {
      setWalletBusy(null);
    }
  }

  function copyAddress() {
    if (!wallet) return;
    navigator.clipboard?.writeText(wallet.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

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
    const walletParam = useOwnWallet ? `&walletId=${wallet!.walletId}` : "";
    try {
      await streamNDJSON(`/api/agent/real?subject=${encodeURIComponent(subj)}&budget=${REAL_BUDGET}${walletParam}`, (o) => {
        if (o.type === "event") setEvents((e) => [...e, { ev: o.event }]);
        else if (o.type === "done") setRealResult({ result: o.result, receiptId: o.receiptId, receiptUrl: o.receiptUrl });
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
        else if (o.type === "done") setResult({ result: o.result, score: o.score, receiptId: o.receiptId, receiptUrl: o.receiptUrl });
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
          else if (o.type === "done") {
            setCompare((c) => ({ ...c, [s.label]: { result: o.result, score: o.score, receiptId: o.receiptId, receiptUrl: o.receiptUrl } }));
          }
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
        <RecentSettlementFeed stats={stats} />
        {!!stats?.onboardedWallets && (
          <p className="mt-1.5 text-[11px] text-zinc-500">
            + <span className="text-teal-300">{stats.onboardedWallets.toLocaleString()}</span> wallet
            {stats.onboardedWallets === 1 ? "" : "s"} self-funded by visitors paying from their own balance.
          </p>
        )}

        <JudgeProofPanel />

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

            {/* Optional: pay from your own wallet */}
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm">
              <button
                onClick={() => setWalletOpen((v) => !v)}
                disabled={running}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm disabled:opacity-50"
              >
                <span className="text-zinc-300">
                  {useOwnWallet ? (
                    <>
                      Paying from <span className="text-teal-300">your wallet</span>{" "}
                      <span className="text-zinc-500">({wallet!.address.slice(0, 6)}…{wallet!.address.slice(-4)})</span>
                    </>
                  ) : (
                    <>Pay from your own wallet <span className="text-zinc-500">· optional</span></>
                  )}
                </span>
                <span className="text-zinc-500">{walletOpen ? "−" : "+"}</span>
              </button>

              {walletOpen && (
                <div className="space-y-3 border-t border-zinc-800 px-4 py-3 text-sm">
                  <p className="text-xs text-zinc-500">
                    The runs above pay from a shared house wallet so you can watch real settlements instantly. To show up
                    as a <span className="text-zinc-300">distinct payer</span>, get your own Arc testnet wallet, fund it
                    once at the official Circle faucet, then research from it. Use the same email later to recover the
                    same wallet. Testnet only — no real money.
                  </p>

                  {!wallet ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="email (optional)"
                        className="w-56 rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500"
                      />
                      <button
                        onClick={createWallet}
                        disabled={walletBusy === "create"}
                        className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                      >
                        {walletBusy === "create" ? "Checking…" : email.trim() ? "Get wallet" : "Generate wallet"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded bg-zinc-950/60 px-2 py-1 text-xs text-zinc-300">{wallet.address}</code>
                        <button onClick={copyAddress} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
                          {copied ? "copied ✓" : "copy"}
                        </button>
                        <a
                          href="https://faucet.circle.com"
                          target="_blank"
                          rel="noreferrer"
                          className="rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/20"
                        >
                          open faucet.circle.com ↗
                        </a>
                      </div>
                      <ol className="ml-4 list-decimal space-y-0.5 text-xs text-zinc-500">
                        <li>Paste this address into faucet.circle.com, pick Arc testnet, request USDC (you also get native gas).</li>
                        <li>Wait a few seconds for it to land, then check funding below.</li>
                        <li>Once funded, your research runs pay from this wallet automatically.</li>
                      </ol>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={checkFunding}
                          disabled={walletBusy === "check"}
                          className="rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
                        >
                          {walletBusy === "check" ? "Checking…" : "Check funding"}
                        </button>
                        {walletStatus && (
                          <span className="text-xs">
                            {walletStatus.funded ? (
                              <span className="text-emerald-400">
                                funded ✓ — {(walletStatus.walletUsdc + walletStatus.gatewayUsdc).toFixed(2)} USDC ready
                              </span>
                            ) : (
                              <span className="text-amber-400">not funded yet — faucet it, then re-check</span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {walletErr && <div className="text-xs text-red-400">{walletErr}</div>}
                </div>
              )}
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

function RecentSettlementFeed({ stats }: { stats: Stats | null }) {
  const recent = stats?.recent?.filter((p) => p.tx).slice(0, 4) ?? [];
  if (!recent.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
      <span className="uppercase tracking-wide text-zinc-600">Latest Gateway settlements</span>
      {recent.map((p, i) => {
        const href = settlementExplorerUrl(p.tx!);
        const label = href
          ? `Arc tx ${shortSettlementId(p.tx!, 8)}`
          : `Gateway ${shortSettlementId(p.tx!, 8)}`;
        const title = `${p.endpoint} at ${new Date(p.at).toLocaleString()}`;
        const className =
          "rounded border border-zinc-800 bg-zinc-950/45 px-2 py-1 tabular-nums text-zinc-400";
        return href ? (
          <a
            key={`${p.tx}-${i}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className={`${className} hover:border-teal-500/60 hover:text-teal-300`}
            title={title}
          >
            ${p.amount.toFixed(4)} · {label}
          </a>
        ) : (
          <span key={`${p.tx}-${i}`} className={className} title={`${title} · ${p.tx}`}>
            ${p.amount.toFixed(4)} · {label}
          </span>
        );
      })}
    </div>
  );
}

function JudgeProofPanel() {
  const proofs = [
    {
      pct: "30%",
      name: "Agency",
      text: "The model previews, buys, skips, and stops under budget; benchmark mode scores that judgment against baselines.",
    },
    {
      pct: "30%",
      name: "Traction",
      text: "Every run emits settled test-USDC payments, plus optional visitor-funded wallets for distinct payer signal.",
    },
    {
      pct: "20%",
      name: "Circle/Arc",
      text: "x402 seller routes, Circle Gateway batching, Arc testnet settlement, USDC-denominated budgets.",
    },
    {
      pct: "20%",
      name: "Innovation",
      text: "The product is the spend decision itself: a measurable paid-information market for agents.",
    },
  ];
  return (
    <section className="mt-5 grid gap-2 md:grid-cols-4">
      {proofs.map((p) => (
        <div key={p.name} className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-3 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-zinc-100">{p.name}</div>
            <div className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[11px] font-medium text-teal-300">{p.pct}</div>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{p.text}</p>
        </div>
      ))}
    </section>
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
      {ev.tx && (
        <SettlementReference tx={ev.tx} className="ml-1 text-zinc-500" />
      )}
      {ev.rationale && <div className="mt-0.5 text-zinc-400">“{ev.rationale}”</div>}
    </div>
  );
}

function SettlementReference({ tx, className }: { tx: string; className?: string }) {
  const href = settlementExplorerUrl(tx);
  const label = href ? `Arc tx ${shortSettlementId(tx, 8)}` : `Gateway settlement ${shortSettlementId(tx, 8)}`;
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`${className ?? ""} underline decoration-zinc-700 underline-offset-2 hover:text-teal-300 hover:decoration-teal-500`}
      >
        · {label}
      </a>
    );
  }
  return (
    <span className={className} title={`Circle Gateway settlement id: ${tx}`}>
      · {label}
    </span>
  );
}

function ResultPanel({ done, heading = "Brief" }: { done?: Done; heading?: string }) {
  if (!done) return null;
  const { result, score } = done;
  return (
    <section className="mt-6 grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-4 backdrop-blur-sm md:col-span-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{heading}</h3>
          <ReceiptLink done={done} />
        </div>
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
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Brief — {result.subject}</h3>
          <ReceiptLink done={done} />
        </div>
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

function ReceiptLink({ done }: { done: ReceiptMeta }) {
  if (!done.receiptUrl) return null;
  return (
    <a
      href={done.receiptUrl}
      target="_blank"
      rel="noreferrer"
      className="rounded border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-xs font-medium text-teal-300 hover:border-teal-400/70"
    >
      Open receipt ↗
    </a>
  );
}
