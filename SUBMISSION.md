# Crux — submission notes (Lepton Agents Hackathon · RFB-01)

**Live:** https://crux-khaki.vercel.app · **Repo:** https://github.com/dmetagame/crux
**RFB-01 — Autonomous Paying Agents.** Settlement: Circle Gateway nanopayments on Arc testnet (x402).

---

## One-liner
Crux is an autonomous research agent that decides *what information is worth paying for* about any
subject, under a strict USDC budget, and buys each source with real x402 nanopayments that settle on
Arc in sub-500ms. **The spending judgment is the product.**

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
purchase rationales, final brief, benchmark score when available, and Arcscan settlement links.
This gives judges a durable artifact to inspect asynchronously instead of relying on a live demo moment.

## How it maps to the judging criteria
- **Agentic sophistication (30%)** — the agent makes genuine cost/value tradeoffs (preview vs buy,
  public-vs-private EDGAR call, redundancy avoidance, rumor skepticism), not scripted automation. The
  Benchmark tab proves this objectively against a ground-truth key and naive baselines.
- **Traction (30%)** — zero-friction by default: no signup, pick a subject, watch real payments flow. The
  live counter (autonomous payments / test-USDC settled / avg tx size / distinct payers) reads straight
  from on-chain settlements; average transaction size is sub-cent, matching the RFB metric. For *genuine*
  distinct-payer signal, an optional lane lets a visitor generate their own Arc testnet wallet, fund it at
  the official Circle faucet, and pay for research from it — so they appear as a real distinct payer
  (`payment_events.payer` is the buyer address), counted separately as "wallets self-funded by visitors."
  The run receipt pages turn those sessions into shareable proof artifacts.
- **Circle tool usage (20%)** — Circle Gateway batching + x402 (HTTP 402) on Arc; the app is both buyer
  (the agent) and seller (x402-gated source endpoints). Plus an external-counterparty leg paying a
  third-party x402 resource via the Coinbase x402 Bazaar (`npm run external-demo`).
- **Innovation (20%)** — spending-judgment-as-product on *real* data, with an objective scoring harness
  most agents can't show, and a public/private discrimination that makes the budget decision legible.

## Traction question answers (fill live numbers from the counter at submission time)
- **Onboarding / usage:** no-account, one-click. Each subject a visitor researches is an onboarded
  session that produces real on-chain nanopayments. Current counter: see the top of crux-khaki.vercel.app
  (e.g., 200+ autonomous payments, ~$2 test-USDC settled, sub-cent average, across N distinct payer
  wallets). Shareable example chips lower the barrier to a first run.
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
- Demo LLM is Haiku 4.5 (premium models are gated on the free AI Gateway tier and would exceed the 60s
  Hobby function cap); the agent loop is model-agnostic and runs Opus 4.8 unchanged with paid credits.
- Real-subject mode depends on live public APIs; obscure subjects may return less. Curated example chips
  are unambiguous public/private companies that showcase the spend decision cleanly.
- Built on Circle's `arc-nanopayments` reference (Apache-2.0); the validity-window fix, the marketplace,
  the scorer, the real-data layer, the agents, and the UI are ours.
