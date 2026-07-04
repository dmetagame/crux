# Crux — submission notes (Lepton Agents Hackathon · RFB-01)

**Live:** https://crux-khaki.vercel.app · **Repo:** https://github.com/dmetagame/crux
**RFB-01 — Autonomous Paying Agents.** Settlement: Circle Gateway nanopayments on Arc testnet (x402).
**Submission target:** July 6, 2026.

---

## One-liner
Crux is an autonomous research agent that decides *what information is worth paying for* about any
subject, under a strict USDC budget, and buys each source with real x402 nanopayments — verified by
Circle's facilitator in sub-500ms and batch-settled on Arc via Circle Gateway. **The spending judgment
is the product.**

## What it does (two surfaces, one engine)
1. **Research a real subject** — name any company, project, or person. Crux shops live paid sources
   (Wikipedia, Wikidata, SEC EDGAR, Hacker News), previews for free, and buys only what fits, then
   returns a *cited* brief. The visible decision: it pays $0.01 for SEC filings on a **public** company
   (Nvidia, Coinbase, Palantir) and **skips** that spend for a **private** one (OpenAI, Anthropic,
   Stripe) — the agent reasons about what the subject *is* before spending.
2. **Benchmark (scored vs baselines)** — a controlled marketplace with a hidden answer key, built so
   no fixed heuristic wins (price uncorrelated with quality, a macro "trap" source, an unreliable
   high-value source, a cheap misleading rumor). The reasoning agent is scored against ground truth and
   beats naive "buy-cheapest" / "buy-by-quality" baselines: it captures the load-bearing red flags and
   refuses the rumor the baselines swallow. This is our objective proof that the agent decides *well*.

Every run on either surface fires real test-USDC settlements on Arc, counted live on the page.
Completed runs also produce a public receipt URL (`/runs/<id>`) with the source decisions,
purchase rationales, final brief, benchmark score when available, and Gateway settlement proof
metadata, with ArcScan links when a real Arc transaction hash is available.
This gives judges a durable artifact to inspect asynchronously instead of relying on a live demo moment.

## Golden receipts
- Public-company spend decision, Coinbase: https://crux-khaki.vercel.app/runs/6707c268-9a4e-4f9c-b197-e9e8f3ca410c
- Private-company spend decision, OpenAI: https://crux-khaki.vercel.app/runs/e015e4c9-d14b-4e66-90e5-f3cb53e5924c
- Scored benchmark, Northwind Logistics: https://crux-khaki.vercel.app/runs/9859fecb-488b-478d-a5bc-fec3899d9229
- Agent-vs-baselines comparison: https://crux-khaki.vercel.app/runs/512afc48-1a8f-410d-89a4-64e63303b0f5

## Agent-access story
Crux is not only a website. Other agents can discover and use it through:

- `/agents`
- `/.well-known/crux-agent.json`
- `/openapi.json`
- `AGENT_INTEGRATION.md`

Production public house-wallet runner access is intentionally disabled. External agents can either
buy x402 resources directly, pay from a visitor-funded Arc testnet wallet, or use a scoped trusted
Crux agent key for house-wallet runner access. This keeps the demo usable while making the
post-hackathon API posture credible.

## How it maps to the judging criteria
- **Agentic sophistication (30%)** — the agent makes genuine cost/value tradeoffs (preview vs buy,
  public-vs-private EDGAR call, redundancy avoidance, rumor skepticism), not scripted automation. The
  Benchmark tab proves this objectively against a ground-truth key and naive baselines.
- **Traction (30%)** — public proof first: Crux has already produced hundreds of settled autonomous
  test-USDC payments, visible in the live counter (autonomous payments / test-USDC settled / sub-cent
  avg tx size / distinct payers, recorded from settled x402 payments) and in durable receipt pages.
  Judges can inspect the golden receipts asynchronously, then run the product hands-on through the
  self-funded visitor wallet lane: generate an Arc testnet wallet (the same email recovers the same
  wallet), fund it at the official Circle faucet, and run research from it — the payment settles from
  that wallet, so it appears as a genuine distinct payer (`payment_events.payer` is the buyer address),
  counted separately as "wallets self-funded by visitors." House-wallet spend is intentionally gated
  behind admin sessions or scoped trusted-agent keys, with hourly limits, daily budget caps, and
  concurrency locks — the budget-control systems RFB-01 explicitly asks for.
- **Circle tool usage (20%)** — Circle Gateway batching + x402 (HTTP 402) on Arc; the app is both buyer
  (the agent) and seller (x402-gated source endpoints). Plus an external-counterparty leg paying a
  third-party x402 resource via the Coinbase x402 Bazaar (`npm run external-demo`).
- **Innovation (20%)** — spending-judgment-as-product on *real* data, with an objective scoring harness
  most agents can't show, and a public/private discrimination that makes the budget decision legible.

## Traction question answers (fill live numbers from the counter at submission time)
- **Onboarding / usage:** the live counter, latest settlements, and receipt pages are public with no
  account. To run the agent hands-on, a visitor self-funds their own Arc testnet wallet (generate →
  Circle faucet → run) and lands on the counter as a distinct payer; house-wallet runs are reserved for
  operator sessions and scoped agent keys so unauthenticated callers cannot spend the house budget.
  Current counter: see the top of crux-khaki.vercel.app (e.g., 300+ autonomous payments, ~$2.75
  test-USDC settled, sub-cent average, across multiple distinct payer wallets). Shareable example chips and
  golden receipts lower the barrier to a first look.
- **Problem addressed:** paid APIs/data are priced per-request, but agents have no judgment about which
  purchases are worth it under a budget — they over-buy or buy blind. Crux is that missing judgment
  layer: it decides, pays, cites, and stops while budget remains.

## Tech
Next.js 16 (Turbopack) · Vercel AI SDK v6 agent loop (Haiku 4.5 via Vercel AI Gateway) ·
`@circle-fin/x402-batching` GatewayClient on Arc testnet (`eip155:5042002`) ·
x402-gated seller routes (`/api/real/*`, `/api/research/*`) · Supabase `payment_events` for the live
counter · bundled SEC CIK/ticker map (SEC rate-limits datacenter IPs, so the public/private signal is
deterministic and zero-latency; filings enrichment is best-effort live).

## Honest notes
- The demo LLM is Haiku 4.5 — a deliberate budget decision, applied to our own stack: it hits the
  benchmark ceiling (11/11, trap avoided, rumor refused) at a fraction of frontier-model cost, which is
  exactly the cost/value judgment Crux exists to make. The agent loop is model-agnostic and runs
  Opus 4.8 unchanged with paid credits.
- Real-subject mode depends on live public APIs; obscure subjects may return less. Curated example chips
  are unambiguous public/private companies that showcase the spend decision cleanly.
- Built on Circle's `arc-nanopayments` reference (Apache-2.0); the validity-window fix, the marketplace,
  the scorer, the real-data layer, the agents, and the UI are ours.

## What's next (post-submission roadmap)
- **Multi-model second opinions:** the agent loop is model-agnostic, so a second model can critique the
  source plan before any spend — the final decision stays budget-bound and receipt-backed with the
  primary agent. The same marketplace + ground-truth scorer also works as a benchmark for *which model
  spends money better*.
- Scoped agent keys for external teams already work today (`AGENT_INTEGRATION.md`); the roadmap is
  turning those into self-serve onboarding with per-key budgets.
