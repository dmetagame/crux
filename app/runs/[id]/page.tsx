import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import TopoBackground from "@/components/topo-background";
import { SOURCES } from "@/lib/marketplace";
import { REAL_SOURCES } from "@/lib/real-sources";
import { getRunReceipt } from "@/lib/run-receipts";

type ReceiptPageProps = {
  params: Promise<{ id: string }>;
};

type LedgerEntry = {
  n: number;
  sourceId: string;
  price: string;
  delivered: boolean;
  rationale: string;
  tx?: string;
};

type ReceiptEvent =
  | { kind: "preview"; sourceId: string }
  | { kind: "purchase"; sourceId: string; price: string; delivered: boolean; rationale: string; tx?: string };

type ReceiptScore = {
  weighted: number;
  maxWeighted: number;
  coverage: number;
  falseClaim: boolean;
  capturedFacts?: { id: string; fact: string; weight: number }[];
  missedFacts?: { id: string; fact: string; weight: number }[];
};

const SOURCE_NAMES = new Map([
  ...SOURCES.map((s) => [s.id, { name: s.name, price: s.price }] as const),
  ...REAL_SOURCES.map((s) => [s.id, { name: s.name, price: s.price }] as const),
]);

export default function RunReceiptPage(props: ReceiptPageProps) {
  return (
    <main className="relative min-h-screen text-zinc-100">
      <TopoBackground />
      <Suspense fallback={<ReceiptLoading />}>
        <RunReceiptContent {...props} />
      </Suspense>
    </main>
  );
}

async function RunReceiptContent({ params }: ReceiptPageProps) {
  await connection();
  const { id } = await params;
  const receipt = await getRunReceipt(id);
  if (!receipt) notFound();

  const payload = receipt.payload;
  const result = asRecord(payload.result);
  const score = asRecord(payload.score) as ReceiptScore | null;
  const events = asArray(payload.events) as ReceiptEvent[];
  const ledger = asArray(result?.ledger) as LedgerEntry[];
  const citations = asArray(result?.citations) as { sourceId: string; url: string }[];
  const brief = typeof result?.brief === "string" ? result.brief : "";
  const previews = new Set(events.filter((e) => e.kind === "preview").map((e) => e.sourceId));
  const bought = new Map(ledger.map((entry) => [entry.sourceId, entry]));
  const catalog = receipt.mode === "real" ? REAL_SOURCES : SOURCES;

  return (
      <div className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/agent" className="text-xs text-zinc-500 hover:text-teal-300">
              ← Back to Crux
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Run receipt</h1>
              <span className="rounded bg-teal-500/10 px-2 py-1 text-xs font-medium text-teal-300">
                {receipt.mode === "real" ? "real subject" : "scored benchmark"}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Verifiable Crux artifact for <span className="text-zinc-200">{receipt.subject}</span>: budget, source
              decisions, final brief, and Arc settlement links.
            </p>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <div>{new Date(receipt.createdAt).toLocaleString()}</div>
            <code className="mt-1 block rounded bg-zinc-950/60 px-2 py-1 text-[11px] text-zinc-500">{receipt.id}</code>
          </div>
        </div>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="budget" value={money(receipt.budgetUsdc)} />
          <Stat label="spent" value={money(receipt.spentUsdc)} />
          <Stat label="sources bought" value={String(ledger.length)} />
          <Stat label="payer" value={receipt.payerKind === "visitor-wallet" ? "visitor" : "house"} />
          <Stat label="model" value={receipt.model?.replace("anthropic/", "") ?? "unknown"} />
        </section>

        {score && (
          <section className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Objective benchmark score</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Hidden answer-key scoring for the final brief, including false-rumor detection.
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-emerald-400">{Math.round(score.coverage * 100)}%</div>
                <div className="text-xs text-zinc-500">
                  {score.weighted}/{score.maxWeighted} weighted facts · false claim{" "}
                  {score.falseClaim ? <span className="text-red-400">yes</span> : <span className="text-emerald-400">no</span>}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(score.capturedFacts ?? []).map((f) => (
                <span key={f.id} className="rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300" title={f.fact}>
                  {f.id}
                </span>
              ))}
              {(score.missedFacts ?? []).map((f) => (
                <span key={f.id} className="rounded bg-zinc-700/30 px-2 py-1 text-xs text-zinc-500 line-through" title={f.fact}>
                  {f.id}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="mt-5 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/45 backdrop-blur-sm">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Source decisions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950/40 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Price</th>
                  <th className="px-4 py-2 font-medium">Decision</th>
                  <th className="px-4 py-2 font-medium">Rationale / settlement</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((source) => {
                  const buy = bought.get(source.id);
                  const inspected = previews.has(source.id);
                  return (
                    <tr key={source.id} className="border-t border-zinc-800">
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-200">{source.name}</div>
                        <div className="text-xs text-zinc-600">{source.id}</div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-400">{source.price}</td>
                      <td className="px-4 py-3">
                        {buy ? (
                          <span className="rounded bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-300">
                            bought{buy.delivered ? "" : " · no data"}
                          </span>
                        ) : inspected ? (
                          <span className="rounded bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-300">previewed, skipped</span>
                        ) : (
                          <span className="rounded bg-zinc-800/70 px-2 py-1 text-xs font-medium text-zinc-500">not inspected</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {buy?.rationale && <div>{buy.rationale}</div>}
                        {buy?.tx && (
                          <a
                            href={arcscanTx(buy.tx)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-xs text-teal-300 underline decoration-teal-900 underline-offset-2"
                          >
                            Arc tx {buy.tx.slice(0, 10)}...
                          </a>
                        )}
                        {!buy && inspected && <span className="text-xs text-zinc-600">Agent inspected the free preview and declined to spend.</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 backdrop-blur-sm md:col-span-2">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Final brief</h2>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{brief || "(no brief captured)"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 backdrop-blur-sm">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Proof</h2>
            <div className="space-y-2 text-sm text-zinc-400">
              <ProofLine label="Previews" value={String(previews.size)} />
              <ProofLine label="Purchases" value={String(ledger.length)} />
              <ProofLine label="Arc txs" value={String(ledger.filter((l) => l.tx).length)} />
              <ProofLine label="Tokens" value={String(result?.tokens ?? "unknown")} />
            </div>
            {citations.length > 0 && (
              <div className="mt-4 border-t border-zinc-800 pt-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Citations</div>
                <div className="flex flex-wrap gap-2">
                  {citations.map((c) => (
                    <a
                      key={`${c.sourceId}-${c.url}`}
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/20"
                    >
                      {sourceName(c.sourceId)} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
  );
}

function ReceiptLoading() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="h-5 w-28 rounded bg-zinc-900/70" />
      <div className="mt-5 h-8 w-56 rounded bg-zinc-900/70" />
      <div className="mt-3 h-4 max-w-xl rounded bg-zinc-900/70" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg border border-zinc-800 bg-zinc-900/55" />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/55 px-3 py-2 backdrop-blur-sm">
      <div className="truncate text-lg font-semibold tabular-nums text-teal-300">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

function ProofLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-zinc-800/60 pb-1 last:border-0">
      <span className="text-zinc-500">{label}</span>
      <span className="tabular-nums text-zinc-200">{value}</span>
    </div>
  );
}

function sourceName(id: string) {
  return SOURCE_NAMES.get(id)?.name ?? pretty(id);
}

function pretty(id: string) {
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function money(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  return `$${value.toFixed(value < 0.01 ? 4 : 3)}`;
}

function arcscanTx(tx: string) {
  return `https://testnet.arcscan.app/tx/${tx}`;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
