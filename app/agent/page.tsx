"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, LogIn, ReceiptText, RefreshCw, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import CruxMark from "@/components/crux-mark";
import PageMotion from "@/components/page-motion";
import TopoBackground from "@/components/topo-background";
import {
  settlementExplorerUrl,
  settlementLabel,
  settlementStatusLabel,
  type SettlementKind,
  type SettlementStatus,
} from "@/lib/settlement";

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
  claims?: { text: string; sourceIds: string[]; evidence: string }[];
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
type WorkspaceRole = "visitor" | "operator";

interface Stats {
  totalPayments: number;
  totalUsdc: number;
  avgUsdc: number;
  distinctPayers: number;
  onboardedWallets?: number;
  completedTasks?: number;
  costPerCompletedTaskUsdc?: number;
  budgetUtilization?: number;
  recent?: RecentPayment[];
}

interface RecentPayment {
  amount: number;
  endpoint: string;
  tx?: string | null;
  settlementReference?: string | null;
  settlementKind?: SettlementKind;
  settlementStatus?: SettlementStatus;
  arcTxHash?: string | null;
  arcChainId?: number | null;
  arcBlockNumber?: string | null;
  arcConfirmedAt?: string | null;
  at: string;
}

interface WalletInfo {
  walletId: string;
  address: string;
  walletToken: string;
}
interface WalletStatus {
  funded: boolean;
  walletUsdc: number;
  gatewayUsdc: number;
}
interface AdminSession {
  configured: boolean;
  authenticated: boolean;
}

const BUDGET = 0.05;
const REAL_BUDGET = 0.03;
const OPERATOR_LOGIN_HREF = "/admin/login?next=%2Fagent%3Fmode%3Doperator";

// Curated, unambiguous example subjects. Public ones should make the agent buy
// SEC EDGAR; private ones should make it skip that $0.01 spend — the visible
// judgement call.
const PUBLIC_EXAMPLES = ["Nvidia", "Coinbase", "Palantir"];
const PRIVATE_EXAMPLES = ["OpenAI", "Anthropic", "Stripe"];
const FEATURED_RECEIPTS = [
  {
    label: "Public company",
    title: "Coinbase buys SEC filings",
    href: "/runs/6707c268-9a4e-4f9c-b197-e9e8f3ca410c",
    meta: "$0.012 spent · Wikipedia + EDGAR",
  },
  {
    label: "Private company",
    title: "OpenAI skips EDGAR spend",
    href: "/runs/e015e4c9-d14b-4e66-90e5-f3cb53e5924c",
    meta: "$0.005 spent · news + Wikipedia",
  },
  {
    label: "Scored benchmark",
    title: "Northwind agent run",
    href: "/runs/9859fecb-488b-478d-a5bc-fec3899d9229",
    meta: "100% coverage · no false claim",
  },
  {
    label: "Comparison",
    title: "Agent beats baselines",
    href: "/runs/512afc48-1a8f-410d-89a4-64e63303b0f5",
    meta: "100% vs 55% · baselines swallow rumor",
  },
];

async function streamNDJSON(
  url: string,
  onObj: (o: any) => void,
  signal?: AbortSignal,
  init: RequestInit = {},
) {
  const res = await fetch(url, { ...init, signal });
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

function newIdempotencyKey(prefix: string) {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

async function saveComparisonReceipt(
  topic: string,
  results: Record<string, Done>,
  events: { label?: string; ev: AgentEvent }[],
): Promise<ReceiptMeta | null> {
  try {
    const res = await fetch("/api/agent/compare/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, budget: BUDGET, seed: "demo", results, events }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not save comparison receipt");
    return { receiptId: data.receiptId, receiptUrl: data.receiptUrl };
  } catch (err) {
    console.warn("[receipt] comparison save failed:", (err as Error).message);
    return null;
  }
}

export default function AgentPage() {
  return (
    <Suspense fallback={<AgentPageFallback />}>
      <AgentPageContent />
    </Suspense>
  );
}

function AgentPageFallback() {
  return (
    <div className="relative min-h-screen bg-[#050509] text-zinc-100">
      <TopoBackground />
      <div className="relative z-10 mx-auto max-w-5xl px-5 py-10 text-sm text-zinc-400">
        Loading Crux...
      </div>
    </div>
  );
}

function AgentPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"real" | "benchmark">("real");
  const [stats, setStats] = useState<Stats | null>(null);
  const [role, setRole] = useState<WorkspaceRole>("visitor");
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);

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
  const [compareReceipt, setCompareReceipt] = useState<ReceiptMeta | null>(null);
  const [active, setActive] = useState<string | null>(null);

  // real state
  const [subject, setSubject] = useState<string>("Coinbase");
  const [realResult, setRealResult] = useState<RealDone | null>(null);

  // visitor-funded wallet lane
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [walletStatus, setWalletStatus] = useState<WalletStatus | null>(null);
  const [walletBusy, setWalletBusy] = useState<"create" | "check" | null>(null);
  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Use the visitor wallet only after it is funded and authorized.
  const useOwnWallet = !!(wallet?.walletToken && walletStatus?.funded);

  useEffect(() => {
    if (searchParams.get("mode") === "operator") setRole("operator");
  }, [searchParams]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("crux.wallet");
      const saved = raw ? JSON.parse(raw) : null;
      if (
        typeof saved?.walletId === "string" &&
        typeof saved?.address === "string" &&
        typeof saved?.walletToken === "string"
      ) {
        setWallet(saved);
      }
    } catch {
      localStorage.removeItem("crux.wallet");
    }
  }, []);

  useEffect(() => {
    refreshAdminSession();
  }, []);

  async function refreshAdminSession() {
    try {
      const r = await fetch("/api/admin/session", { cache: "no-store" });
      const d = await r.json();
      setAdminSession({ configured: !!d.configured, authenticated: !!d.authenticated });
    } catch {
      setAdminSession({ configured: false, authenticated: false });
    }
  }

  async function createWallet() {
    if (walletBusy) return;
    setWalletBusy("create");
    setWalletErr(null);
    setWalletStatus(null);
    try {
      const r = await fetch("/api/wallet/create", {
        method: "POST",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not create wallet");
      const nextWallet = {
        walletId: d.walletId,
        address: d.address,
        walletToken: d.walletToken,
      };
      setWallet(nextWallet);
      localStorage.setItem("crux.wallet", JSON.stringify(nextWallet));
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
      const r = await fetch(`/api/wallet/status?walletId=${wallet.walletId}`, {
        headers: { "X-Crux-Wallet-Token": wallet.walletToken },
      });
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
      .then((r) => {
        if (!r.ok) throw new Error("Stats unavailable");
        return r.json();
      })
      .then(setStats)
      .catch(() => setStats(null));
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

  function requireOperator() {
    if (adminSession?.authenticated) return true;
    setRole("operator");
    setErr("Sign in as admin to run from the operator wallet.");
    router.push(OPERATOR_LOGIN_HREF);
    return false;
  }

  async function runRealAgent(subj: string) {
    const nextSubject = subj.trim();
    if (running || !nextSubject) return;
    setSubject(nextSubject);
    if (role === "visitor" && !useOwnWallet) {
      setErr("Create and fund a visitor wallet before running as a visitor.");
      return;
    }
    if (role === "operator" && !requireOperator()) return;

    resetRun();
    setRealResult(null);
    const shouldUseOwnWallet = role === "visitor" && useOwnWallet;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Idempotency-Key": newIdempotencyKey("real"),
    };
    if (shouldUseOwnWallet) headers["X-Crux-Wallet-Token"] = wallet!.walletToken;
    try {
      await streamNDJSON(
        "/api/agent/real",
        (o) => {
          if (o.type === "event") setEvents((e) => [...e, { ev: o.event }]);
          else if (o.type === "done") setRealResult({ result: o.result, receiptId: o.receiptId, receiptUrl: o.receiptUrl });
          else if (o.type === "error") setErr(o.message);
        },
        undefined,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            subject: nextSubject,
            budget: REAL_BUDGET,
            walletId: shouldUseOwnWallet ? wallet!.walletId : null,
          }),
        },
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      refreshStats();
    }
  }

  async function runAgent() {
    if (running || !requireOperator()) return;
    setMode("run");
    resetRun();
    setResult(null);
    setCompare({});
    setCompareReceipt(null);
    setActive(null);
    try {
      await streamNDJSON(
        "/api/agent/run",
        (o) => {
          if (o.type === "event") setEvents((e) => [...e, { ev: o.event }]);
          else if (o.type === "done") setResult({ result: o.result, score: o.score, receiptId: o.receiptId, receiptUrl: o.receiptUrl });
          else if (o.type === "error") setErr(o.message);
        },
        undefined,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": newIdempotencyKey("benchmark"),
          },
          body: JSON.stringify({ topic, budget: BUDGET }),
        },
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      refreshStats();
    }
  }

  async function runCompare() {
    if (running || !requireOperator()) return;
    setMode("compare");
    resetRun();
    setResult(null);
    setCompare({});
    setCompareReceipt(null);
    setActive(null);
    const comparison: Record<string, Done> = {};
    const comparisonEvents: { label?: string; ev: AgentEvent }[] = [];
    const steps = [
      {
        label: "reasoning-agent",
        url: "/api/agent/run",
        body: { topic, budget: BUDGET },
        idempotencyKey: newIdempotencyKey("compare-agent"),
      },
      {
        label: "buy-cheapest",
        url: "/api/agent/baseline",
        body: { strategy: "cheapest", topic, budget: BUDGET },
        idempotencyKey: newIdempotencyKey("compare-cheapest"),
      },
      {
        label: "buy-by-quality",
        url: "/api/agent/baseline",
        body: { strategy: "quality", topic, budget: BUDGET },
        idempotencyKey: newIdempotencyKey("compare-quality"),
      },
      {
        label: "preview-aware-heuristic",
        url: "/api/agent/baseline",
        body: { strategy: "preview", topic, budget: BUDGET },
        idempotencyKey: newIdempotencyKey("compare-preview"),
      },
    ];
    try {
      for (const s of steps) {
        setActive(s.label);
        await streamNDJSON(
          s.url,
          (o) => {
            if (o.type === "event") {
              const entry = { label: s.label, ev: o.event };
              comparisonEvents.push(entry);
              setEvents((e) => [...e, entry]);
            }
            else if (o.type === "done") {
              const done = { result: o.result, score: o.score, receiptId: o.receiptId, receiptUrl: o.receiptUrl };
              comparison[s.label] = done;
              setCompare((c) => ({ ...c, [s.label]: done }));
            }
            else if (o.type === "error") setErr(o.message);
          },
          undefined,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": s.idempotencyKey,
            },
            body: JSON.stringify(s.body),
          },
        );
      }
      const receipt = await saveComparisonReceipt(topic, comparison, comparisonEvents);
      setCompareReceipt(receipt);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
      setActive(null);
      refreshStats();
    }
  }

  const order = ["reasoning-agent", "buy-cheapest", "buy-by-quality", "preview-aware-heuristic"];
  const operatorReady = !!adminSession?.authenticated;
  const visitorReady = useOwnWallet;
  const realRunDisabled =
    running ||
    !subject.trim() ||
    (role === "visitor" ? !visitorReady : !operatorReady);
  const activePayerLabel =
    role === "visitor"
      ? visitorReady
        ? "visitor wallet"
        : "visitor wallet required"
      : operatorReady
        ? "operator wallet"
        : "operator login required";

  return (
    <div className="relative min-h-screen bg-[#050509] text-zinc-100">
      <TopoBackground />
      <PageMotion />
      <div className="relative z-10 mx-auto max-w-5xl px-5 py-10">
        {/* Header */}
        <header data-animate className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <CruxMark size={30} className="shrink-0" />
              <h1 className="font-display bg-gradient-to-r from-violet-200 via-violet-100 to-teal-200 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
                Crux
              </h1>
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">paying research agent</span>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Crux decides what information is worth buying about a subject, under a strict USDC budget, and pays for each
              source with real nanopayments through Circle Gateway on Arc. The spending{" "}
              <span className="text-zinc-200">judgment</span> is the product.
            </p>
          </div>
          <a
            href="/agents"
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/55 px-3 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-sm hover:border-teal-500/60 hover:text-teal-300"
          >
            Agent API
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
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

        <VerifyCruxPanel />
        <JudgeProofPanel />
        <FeaturedReceipts />
        <RoleWorkspacePanel
          role={role}
          setRole={setRole}
          adminSession={adminSession}
          refreshAdminSession={refreshAdminSession}
          wallet={wallet}
          walletStatus={walletStatus}
          walletBusy={walletBusy}
          walletErr={walletErr}
          copied={copied}
          createWallet={createWallet}
          checkFunding={checkFunding}
          copyAddress={copyAddress}
          running={running}
        />

        {/* Tabs */}
        <div data-animate className="mt-6 flex gap-1 border-b border-zinc-800">
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
                disabled={realRunDisabled}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {running ? "Researching…" : role === "visitor" ? "Research with visitor wallet" : "Research with operator wallet"}
              </button>
              <span className="text-xs text-zinc-500">
                ${REAL_BUDGET} USDC budget · Arc testnet · {activePayerLabel}
              </span>
            </div>

            <div className="mt-3 space-y-1.5">
              <ChipRow label="Public" hint="→ should buy SEC filings" items={PUBLIC_EXAMPLES} onPick={runRealAgent} disabled={running} />
              <ChipRow label="Private" hint="→ should skip them" items={PRIVATE_EXAMPLES} onPick={runRealAgent} disabled={running} />
            </div>

            <LiveActivity events={events} running={running} logRef={logRef} budget={REAL_BUDGET} />
            {realResult && <RealResultPanel done={realResult} />}
          </div>
        )}

        {/* =========================== BENCHMARK TAB =========================== */}
        {tab === "benchmark" && (
          <div className="mt-5">
            <p className="mb-3 max-w-2xl text-sm text-zinc-400">
              A controlled marketplace with a known answer key, built so no fixed heuristic wins. Run the agent, or compare
              it against two naive metadata controls and a stronger preview-aware non-LLM heuristic on the same budget.
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
                disabled={running || !operatorReady}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {running && mode === "run" ? "Running…" : "Run agent"}
              </button>
              <button
                onClick={runCompare}
                disabled={running || !operatorReady}
                className="rounded-md border border-zinc-700 bg-zinc-900/55 px-4 py-2 text-sm font-medium backdrop-blur-sm hover:border-zinc-600 disabled:opacity-50"
              >
                {running && mode === "compare" ? "Comparing…" : "Compare vs non-LLM controls"}
              </button>
              <span className="text-xs text-zinc-500">
                Real USDC · Arc testnet · {operatorReady ? "operator wallet" : "operator login required"} · reproducible (seed: demo)
              </span>
            </div>

            <LiveActivity events={events} running={running} logRef={logRef} active={active} />

            {mode === "run" && result && <ResultPanel done={result} />}

            {mode === "compare" && Object.keys(compare).length > 0 && (
              <section className="mt-6">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Comparison — {topic}</h2>
                  <ReceiptLink done={compareReceipt ?? {}} label="Open comparison receipt ↗" />
                </div>
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
                    with no false claim — compare its cost and coverage against both naive controls and the stronger preview-aware heuristic.
                  </p>
                )}
                <ResultPanel done={compare["reasoning-agent"]} heading="Agent's brief" />
              </section>
            )}
          </div>
        )}

        <footer className="mt-10 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
          Payments settle through Circle Gateway batching on Arc testnet; ArcScan links appear when Gateway returns an EVM tx hash.
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

/**
 * USDC amount with the constant noise de-emphasized: sub-cent values dim the
 * leading "0.00…" so the significant digits pop; larger values dim the extra
 * precision past cents. One string, split for display — never double-rounded.
 */
function UsdStat({ value, decimals = 4 }: { value: number; decimals?: number }) {
  const text = value.toFixed(decimals);
  if (value > 0 && value < 0.01) {
    const m = text.match(/^(0\.0+)(\d.*)$/);
    if (m) {
      return (
        <span>
          $<span className="text-zinc-500">{m[1]}</span>
          {m[2]}
        </span>
      );
    }
    return <span>${text}</span>;
  }
  const dot = text.indexOf(".");
  const main = dot === -1 ? text : text.slice(0, dot + 3);
  const tail = dot === -1 ? "" : text.slice(dot + 3);
  return (
    <span>
      ${main}
      {tail && <span className="text-zinc-500">{tail}</span>}
    </span>
  );
}

function StatsBar({ stats }: { stats: Stats | null }) {
  const cells: { label: string; value: React.ReactNode }[] = [
    { label: "autonomous payments", value: stats ? stats.totalPayments.toLocaleString() : "—" },
    { label: "x402 USDC accepted", value: stats ? <UsdStat value={stats.totalUsdc} /> : "—" },
    { label: "avg tx size", value: stats ? <UsdStat value={stats.avgUsdc} /> : "—" },
    { label: "distinct payers", value: stats ? stats.distinctPayers.toLocaleString() : "—" },
    { label: "cost / completed task", value: stats ? <UsdStat value={stats.costPerCompletedTaskUsdc ?? 0} /> : "—" },
    { label: "budget utilization", value: stats ? `${((stats.budgetUtilization ?? 0) * 100).toFixed(1)}%` : "—" },
  ];
  return (
    <div data-animate className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="rounded-lg border border-zinc-800 bg-zinc-900/55 px-4 py-3 backdrop-blur-sm">
          <div className="font-display text-2xl font-semibold tracking-tight text-zinc-100">{c.value}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function RecentSettlementFeed({ stats }: { stats: Stats | null }) {
  const recent =
    stats?.recent?.filter((p) => p.settlementReference ?? p.tx).slice(0, 4) ??
    [];
  if (!recent.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
      <span className="uppercase tracking-wide text-zinc-600">/ latest settlements</span>
      {recent.map((p, i) => {
        const reference = p.settlementReference ?? p.tx!;
        const href = p.arcTxHash
          ? settlementExplorerUrl(p.arcTxHash)
          : settlementExplorerUrl(reference);
        const label = settlementLabel(reference, 8);
        const proof = settlementStatusLabel(p.settlementStatus);
        const title = `${p.endpoint} at ${new Date(p.at).toLocaleString()}`;
        const className =
          "inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-950/45 px-2 py-1 text-zinc-500";
        const body = (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            <span className="font-mono text-zinc-300">${p.amount.toFixed(4)}</span>
            <span>· {proof} · <span className="font-mono">{label}</span></span>
          </>
        );
        return href ? (
          <a
            key={`${reference}-${i}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className={`${className} hover:border-emerald-500/60 hover:text-emerald-300`}
            title={title}
          >
            {body}
          </a>
        ) : (
          <span key={`${reference}-${i}`} className={className} title={`${title} · ${reference}`}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

function VerifyCruxPanel() {
  const checks = [
    {
      label: "Inspect receipts",
      text: "Durable runs show budgets, buys, skips, final output, and Gateway settlement refs.",
      href: "#featured-receipts",
    },
    {
      label: "Run hands-on",
      text: "Use a self-funded visitor wallet; payments come from that wallet and count as a distinct payer.",
      href: "#visitor-wallet",
    },
    {
      label: "Track settlement",
      text: "Open a receipt for Gateway refs; ArcScan links appear when Gateway exposes an Arc transaction hash.",
      href: FEATURED_RECEIPTS[0].href,
    },
    {
      label: "Agent access",
      text: "External agents can discover x402 resources through OpenAPI and the well-known manifest.",
      href: "/agents",
    },
  ];
  return (
    <section data-animate className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-4 w-4 text-teal-300" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-zinc-100">Verify Crux</h2>
        </div>
        <span className="text-[11px] uppercase tracking-wide text-zinc-600">built for async judging</span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        {checks.map((check) => (
          <a
            key={check.label}
            href={check.href}
            target={check.href.startsWith("http") ? "_blank" : undefined}
            rel={check.href.startsWith("http") ? "noreferrer" : undefined}
            className="group rounded-md border border-zinc-800 bg-zinc-950/35 p-3 hover:border-teal-500/60"
          >
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-zinc-200">
              {check.label}
              <ExternalLink className="h-3.5 w-3.5 text-zinc-600 group-hover:text-teal-300" aria-hidden="true" />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{check.text}</p>
          </a>
        ))}
      </div>
    </section>
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
      text: "Every run emits Gateway-settled test-USDC payments, plus optional visitor-funded wallets for distinct payer signal.",
    },
    {
      pct: "20%",
      name: "Circle/Arc",
      text: "x402 seller routes, Circle Gateway batching on Arc testnet, USDC-denominated budgets.",
    },
    {
      pct: "20%",
      name: "Innovation",
      text: "The product is the spend decision itself: a measurable paid-information market for agents.",
    },
  ];
  return (
    <section data-animate className="mt-5 grid gap-2 md:grid-cols-4">
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

function FeaturedReceipts() {
  return (
    <section data-animate id="featured-receipts" className="mt-5 scroll-mt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">/ proof receipts</h2>
        <span className="text-[11px] text-zinc-600">Durable artifacts from live Arc testnet runs</span>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {FEATURED_RECEIPTS.map((receipt) => (
          <a
            key={receipt.href}
            href={receipt.href}
            className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-3 backdrop-blur-sm hover:border-teal-500/60"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-teal-300">
                {receipt.label}
              </span>
              <ExternalLink className="h-3.5 w-3.5 text-zinc-600" aria-hidden="true" />
            </div>
            <div className="mt-2 text-sm font-semibold text-zinc-100">{receipt.title}</div>
            <div className="mt-1 text-xs leading-relaxed text-zinc-500">{receipt.meta}</div>
          </a>
        ))}
      </div>
    </section>
  );
}

function RoleWorkspacePanel({
  role,
  setRole,
  adminSession,
  refreshAdminSession,
  wallet,
  walletStatus,
  walletBusy,
  walletErr,
  copied,
  createWallet,
  checkFunding,
  copyAddress,
  running,
}: {
  role: WorkspaceRole;
  setRole: (role: WorkspaceRole) => void;
  adminSession: AdminSession | null;
  refreshAdminSession: () => Promise<void>;
  wallet: WalletInfo | null;
  walletStatus: WalletStatus | null;
  walletBusy: "create" | "check" | null;
  walletErr: string | null;
  copied: boolean;
  createWallet: () => Promise<void>;
  checkFunding: () => Promise<void>;
  copyAddress: () => void;
  running: boolean;
}) {
  const visitorSelected = role === "visitor";
  const operatorSelected = role === "operator";
  const walletReady = !!(wallet?.walletToken && walletStatus?.funded);
  const operatorReady = !!adminSession?.authenticated;
  const visitorBadge = walletReady ? "funded" : wallet ? "faucet needed" : "self-funded";
  const cardBase = "rounded-lg border bg-zinc-900/45 backdrop-blur-sm transition";

  return (
    <section data-animate className="mt-5 grid gap-3 md:grid-cols-2">
      <div id="visitor-wallet" className={`${cardBase} scroll-mt-4 ${visitorSelected ? "border-teal-500/70" : "border-zinc-800"}`}>
        <button
          type="button"
          onClick={() => setRole("visitor")}
          disabled={running}
          className="flex w-full items-start gap-3 p-4 text-left disabled:opacity-50"
        >
          <span className="rounded-md border border-teal-500/30 bg-teal-500/10 p-2 text-teal-300">
            <UserRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">
              Hands-on visitor wallet
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${walletReady ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                {visitorBadge}
              </span>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
              Create a fresh Crux-hosted Arc testnet wallet. Keep its browser capability token, fund it at Circle faucet,
              then Crux pays from that balance.
            </span>
          </span>
        </button>

        {visitorSelected && (
          <div className="space-y-3 border-t border-zinc-800 px-4 pb-4 pt-3">
            <div className="grid gap-2 text-[11px] text-zinc-500 sm:grid-cols-4">
              {["1. Create", "2. Faucet", "3. Check", "4. Research"].map((step) => (
                <span key={step} className="rounded border border-zinc-800 bg-zinc-950/35 px-2 py-1 text-center">
                  {step}
                </span>
              ))}
            </div>
            {!wallet ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-500">
                  This creates a new testnet wallet. Its capability stays in this browser and expires automatically.
                </p>
                <button
                  type="button"
                  onClick={createWallet}
                  disabled={running || walletBusy === "create"}
                  className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  <Wallet className="h-4 w-4" aria-hidden="true" />
                  {walletBusy === "create" ? "Checking..." : "Get wallet"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="max-w-full overflow-hidden text-ellipsis rounded bg-zinc-950/70 px-2 py-1 text-xs text-zinc-300">
                    {wallet.address}
                  </code>
                  <button
                    type="button"
                    onClick={copyAddress}
                    disabled={running}
                    className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {copied ? "copied" : "copy"}
                  </button>
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/20"
                  >
                    faucet.circle.com
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={checkFunding}
                    disabled={running || walletBusy === "check"}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/40 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    {walletBusy === "check" ? "Checking..." : "Check funding"}
                  </button>
                  {walletStatus ? (
                    <span className={`text-xs ${walletStatus.funded ? "text-emerald-400" : "text-amber-400"}`}>
                      {walletStatus.funded
                        ? `${(walletStatus.walletUsdc + walletStatus.gatewayUsdc).toFixed(2)} USDC ready`
                        : "not funded yet"}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">Fund once, then check before running.</span>
                  )}
                </div>
              </div>
            )}
            {walletErr && <div className="text-xs text-red-400">{walletErr}</div>}
          </div>
        )}
      </div>

      <div className={`${cardBase} ${operatorSelected ? "border-violet-500/70" : "border-zinc-800"}`}>
        <button
          type="button"
          onClick={() => setRole("operator")}
          disabled={running}
          className="flex w-full items-start gap-3 p-4 text-left disabled:opacity-50"
        >
          <span className="rounded-md border border-violet-500/30 bg-violet-500/10 p-2 text-violet-300">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">
              Operator wallet
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${operatorReady ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>
                {operatorReady ? "unlocked" : "admin login"}
              </span>
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
              Admin mode uses the embedded house wallet for demos, benchmarks, and judge-facing proof runs.
            </span>
          </span>
        </button>

        {operatorSelected && (
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-4 pb-4 pt-3">
            {operatorReady ? (
              <>
                <span className="text-xs text-emerald-400">Admin session active.</span>
                <a
                  href="/dashboard"
                  className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
                >
                  Dashboard
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <button
                  type="button"
                  onClick={refreshAdminSession}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Refresh
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-zinc-500">
                  {adminSession?.configured === false ? "Admin auth is not configured." : "Sign in to use the operator wallet."}
                </span>
                <a
                  href={OPERATOR_LOGIN_HREF}
                  className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
                >
                  <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign in
                </a>
              </>
            )}
          </div>
        )}
      </div>
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
  budget,
}: {
  events: { label?: string; ev: AgentEvent }[];
  running: boolean;
  logRef: React.RefObject<HTMLDivElement | null>;
  active?: string | null;
  budget?: number;
}) {
  if (events.length === 0 && !running) return null;
  const spent = events.reduce(
    (s, e) => (e.ev.kind === "purchase" ? s + (parseFloat(e.ev.price.replace(/[^0-9.]/g, "")) || 0) : s),
    0,
  );
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        / live activity {active && <span className="text-zinc-400">· {active}</span>}
      </h2>
      {typeof budget === "number" && (
        <div className="mb-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-emerald-500/15">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
            spent ${spent.toFixed(3)} / ${budget.toFixed(2)} budget
          </span>
        </div>
      )}
      <div ref={logRef} data-lenis-prevent className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/55 p-3 backdrop-blur-sm">
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
      <div className="flex items-center gap-2 px-2.5 py-1 text-xs">
        <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-400">
          preview
        </span>
        {label && <span className="text-zinc-600">[{label}]</span>}
        <span className="min-w-0 flex-1 truncate text-zinc-400">{pretty(ev.sourceId)}</span>
        <span className="font-mono text-[11px] text-zinc-600">free</span>
      </div>
    );
  }
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
          buy
        </span>
        {label && <span className="text-zinc-600">[{label}]</span>}
        <span className="min-w-0 flex-1 truncate text-zinc-200">{pretty(ev.sourceId)}</span>
        {ev.delivered ? (
          <span className="flex items-center gap-1 text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            settled
          </span>
        ) : (
          <span className="text-amber-400">no usable data</span>
        )}
        <span className="font-mono text-[11px] font-medium text-zinc-100">{ev.price}</span>
      </div>
      {(ev.rationale || ev.tx) && (
        <div className="mt-0.5 flex items-baseline gap-2">
          {ev.rationale && <span className="min-w-0 flex-1 text-zinc-400">“{ev.rationale}”</span>}
          {ev.tx && <SettlementReference tx={ev.tx} className="shrink-0 text-zinc-600" />}
        </div>
      )}
    </div>
  );
}

function SettlementReference({ tx, className }: { tx: string; className?: string }) {
  const href = settlementExplorerUrl(tx);
  const label = settlementLabel(tx, 8);
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`${className ?? ""} font-mono underline decoration-zinc-700 underline-offset-2 hover:text-teal-300 hover:decoration-teal-500`}
      >
        · {label}
      </a>
    );
  }
  return (
    <span className={`${className ?? ""} font-mono`} title={`Circle Gateway settlement reference: ${tx}`}>
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
        {!!result.claims?.length && (
          <div className="mt-4 border-t border-zinc-800 pt-3">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Claim provenance</div>
            <div className="space-y-1.5">
              {result.claims.slice(0, 6).map((claim, index) => (
                <div key={`${index}-${claim.text}`} className="text-xs text-zinc-400">
                  <span className="text-zinc-200">{claim.text}</span>
                  <span className="text-teal-300"> · {claim.sourceIds.join(", ")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
          <div className="text-2xl font-semibold tracking-tight text-zinc-100">
            <UsdStat value={result.spent} decimals={3} />
          </div>
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

function ReceiptLink({ done, label = "Open receipt ↗" }: { done: ReceiptMeta; label?: string }) {
  if (!done.receiptUrl) return null;
  return (
    <a
      href={done.receiptUrl}
      target="_blank"
      rel="noreferrer"
      className="rounded border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-xs font-medium text-teal-300 hover:border-teal-400/70"
    >
      {label}
    </a>
  );
}
