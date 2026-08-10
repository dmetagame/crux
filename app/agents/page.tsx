import type { Metadata } from "next";
import Link from "next/link";
import { Code2, ExternalLink, KeyRound, ReceiptText, ShieldCheck, Wallet } from "lucide-react";
import TopoBackground from "@/components/topo-background";

export const metadata: Metadata = {
  title: "Crux Agent API",
  description:
    "Discovery, auth modes, and integration examples for agents using Crux payment-native research.",
};

const baseUrl = "https://crux-khaki.vercel.app";

const snippets = [
  {
    title: "Discover Crux",
    body: `curl ${baseUrl}/.well-known/crux-agent.json
curl ${baseUrl}/openapi.json
curl ${baseUrl}/api/marketplace`,
  },
  {
    title: "Buy an x402 resource",
    body: `curl -i "${baseUrl}/api/real/wikipedia?subject=Coinbase"`,
  },
  {
    title: "Create a visitor wallet",
    body: `curl -sS -X POST "${baseUrl}/api/wallet/create"`,
  },
  {
    title: "Run from a visitor wallet",
    body: `curl -N -X POST "${baseUrl}/api/agent/real" \\
  -H "Content-Type: application/json" \\
  -H "X-Crux-Wallet-Token: $WALLET_TOKEN" \\
  -H "Idempotency-Key: visitor-coinbase-001" \\
  -d '{"subject":"Coinbase","budget":0.03,"walletId":"'$WALLET_ID'"}'`,
  },
  {
    title: "Run as a trusted agent",
    body: `curl -N -X POST "${baseUrl}/api/agent/real" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $CRUX_AGENT_KEY" \\
  -H "Idempotency-Key: trusted-coinbase-001" \\
  -d '{"subject":"Coinbase","budget":0.03}'`,
  },
];

export default function AgentsPage() {
  return (
    <main className="relative min-h-screen bg-[#050509] text-zinc-100">
      <TopoBackground />
      <div className="relative z-10 mx-auto max-w-5xl px-5 py-10">
        <header className="flex flex-col gap-4 border-b border-zinc-900 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              href="/agent"
              className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
            >
              Crux
            </Link>
            <h1 className="mt-2 bg-gradient-to-r from-violet-200 via-violet-100 to-teal-200 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              Agent API
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              Crux lets external agents buy individual x402 resources, run research from a
              Crux-hosted visitor-funded Arc wallet, or use a scoped trusted-agent key for house-wallet runs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DocLink href="/.well-known/crux-agent.json" label="Discovery" />
            <DocLink href="/openapi.json" label="OpenAPI" />
            <DocLink href="https://github.com/dmetagame/crux/blob/main/AGENT_INTEGRATION.md" label="Guide" external />
          </div>
        </header>

        <section className="mt-6 grid gap-3 md:grid-cols-3">
          <ModeCard
            icon={<Code2 className="h-4 w-4" aria-hidden="true" />}
            title="x402 resources"
            badge="preferred"
            text="Agents pay Crux directly for one source. No Crux API key is required."
          />
          <ModeCard
            icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
            title="Visitor wallet"
            badge="self-funded"
            text="Create a fresh Crux-hosted Arc testnet wallet, fund it yourself, and run research from that balance."
          />
          <ModeCard
            icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
            title="Trusted key"
            badge="scoped"
            text="Use Bearer auth for house-wallet runner access. Public house-wallet access is disabled."
          />
        </section>

        <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-violet-300" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-zinc-100">Production Auth Posture</h2>
          </div>
          <div className="mt-3 grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
            <p>
              Public house-wallet runner access is off in production. Unauthenticated calls to
              <Endpoint>/api/agent/real</Endpoint>, <Endpoint>/api/agent/run</Endpoint>, and{" "}
              <Endpoint>/api/agent/baseline</Endpoint> return 401 before spend.
            </p>
            <p>
              The web workspace uses an admin session for operator runs. External callers should use
              x402 payments, visitor-wallet auth, or a scoped trusted-agent Bearer key.
            </p>
          </div>
        </section>

        <section className="mt-6 grid gap-3 lg:grid-cols-2">
          {snippets.map((snippet) => (
            <Snippet key={snippet.title} title={snippet.title} body={snippet.body} />
          ))}
        </section>

        <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-2">
            <ReceiptText className="h-4 w-4 text-teal-300" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-zinc-100">Runner Output</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Runner endpoints accept POST JSON, stream NDJSON events, and finish with a durable <Endpoint>receiptUrl</Endpoint>.
            Receipts show budget, previews, purchases, rationale, result, and settlement proof metadata.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs leading-relaxed text-zinc-300">
            <code>{`{"type":"event","event":{"kind":"preview","sourceId":"wikipedia"}}
{"type":"event","event":{"kind":"purchase","sourceId":"wikipedia","price":"$0.0020"}}
{"type":"done","result":{...},"receiptUrl":"${baseUrl}/runs/..."}`}</code>
          </pre>
        </section>
      </div>
    </main>
  );
}

function DocLink({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/55 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-teal-500/60 hover:text-teal-300"
    >
      {label}
      {external && <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
    </a>
  );
}

function ModeCard({
  icon,
  title,
  badge,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  badge: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-teal-500/30 bg-teal-500/10 p-2 text-teal-300">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-medium text-zinc-400">
              {badge}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-500">{text}</p>
    </div>
  );
}

function Snippet({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-4 backdrop-blur-sm">
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <pre className="mt-3 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs leading-relaxed text-zinc-300">
        <code>{body}</code>
      </pre>
    </div>
  );
}

function Endpoint({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-zinc-950/60 px-1 py-0.5 text-xs text-zinc-300">
      {children}
    </code>
  );
}
