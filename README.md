# Crux — Autonomous Paying Research Agent

> Crux decides what information is worth buying about a company, under a strict
> USDC budget, paying for each source with real nanopayments that settle on
> **Arc**. The spending **judgment** is the product — not the report.

Entry for **RFB-01 (Autonomous Paying Agents)** of the Lepton Agents Hackathon
(Canteen × Circle on Arc). Every purchase below is a real x402 nanopayment that
settles on Arc testnet through Circle Gateway batching.

---

## The idea: paying judgment as the product

This is **not** "a research agent." It's an autonomous **paying** agent whose
*spending decisions* are the deliverable — the brief is just the vehicle.

The agent is given a due-diligence task and a **strict USDC budget**, and faces a
marketplace of paid sources deliberately built so that **no fixed heuristic
wins**:

- **price ≠ quality** — some cheap sources are signal, some pricey ones are noise;
- **free previews** on some sources — the agent must judge value *before* paying;
- **overlap** — two cheap sources are near-duplicates (dedup matters);
- **an unreliable source** that takes payment and sometimes returns nothing;
- **a misleading source** — cheap, advertises "high quality", reports a *false*
  acquisition rumor;
- **a "wolf in sheep's clothing"** — metadata identical to the best source, but
  its preview reveals it's industry-macro, useless for *this* company.

Only context-sensitive reasoning — previewing, matching source to question,
skipping traps, stopping when enough — spends the budget well. That is what makes
a real LLM load-bearing here, rather than decorative.

## Proof it reasons (not just transacts)

`npm run compare` runs the reasoning agent against two naive heuristics on the
**same marketplace, budget, and seed** — all paying real USDC on Arc — and scores
each brief against ground truth:

```
Strategy              Spent   Buys   Facts       Coverage  False claim
reasoning-agent      $0.045      3     5/5   11/11 (100%)  no
buy-cheapest        $0.0388      7     3/5     6/11 (55%)  YES (rumor)
buy-by-quality      $0.0353      4     3/5     6/11 (55%)  YES (rumor)
```

Both heuristics spend **less** but capture barely half the facts **and assert a
fabricated acquisition**. `buy-by-quality` wastes $0.02 on the trap source, so it
can't afford the analysis that holds the governance red flags. The agent previews
past the trap, skips the rumor, and gets the complete, accurate picture. That gap
is judgment a rule can't replicate.

## Shareable proof receipts

Every completed web run can persist a public receipt at `/runs/<id>`: the budget,
source previews, purchases, skips, rationales, final brief, benchmark score when
available, and Gateway settlement ids for every paid source. This is the async judging
artifact: a reviewer does not have to trust the live UI or the README; they can
open a single run and inspect what the agent decided and what actually settled.

## Architecture

```
  research agent  ──(Vercel AI SDK + AI Gateway)──►  LLM reasoning
        │  tools: list_marketplace · preview · purchase · check_budget · submit_brief
        ▼
  marketplace (x402-protected Next.js routes)
        │  GET 402 → sign EIP-3009 authorization → retry with payment
        ▼
  Circle Gateway  ──batches signed authorizations──►  single on-chain settlement on Arc
        │
        ▼
  Supabase (payment ledger)        lib/score.ts (objective brief scorer)
```

- **Agent** (`lib/agent.ts`): an AI-SDK tool-calling loop. Model is routed through
  the **Vercel AI Gateway** — develop on `claude-haiku-4.5`, swap one string to
  `claude-opus-4.8` for the demo.
- **Marketplace** (`lib/marketplace.ts`): the decision space — 9 sources with
  varied price/quality/reliability, free previews, the trap, and a misleading
  rumor. Reliability is deterministic under a seed, so runs are reproducible.
- **Settlement** (`lib/x402.ts`): x402 + Circle Gateway batching on Arc. Each
  `purchase` is a real `gateway.pay()` authorization that is settled through
  Circle Gateway.
- **Scorer** (`lib/score.ts`): grades a brief by weighted ground-truth facts
  captured, and flags whether it ingested the false rumor.
- **Baselines** (`lib/baseline.ts`): non-LLM buy-cheapest / buy-by-quality buyers
  for the comparison.

## Everything settles on Arc

- Network: **Arc testnet** (`eip155:5042002`), RPC `https://rpc.testnet.arc.network`
- USDC: `0x3600000000000000000000000000000000000000`; Circle Gateway batching
- Payments are gas-free for the agent (authorizations are batched into one
  on-chain settlement); explorer: `https://testnet.arcscan.app`

## Beyond Arc: genuine external counterparties

The agent's payment capability isn't limited to our own marketplace. `npm run
external-demo` discovers **real third-party x402 services** via Coinbase's x402
Bazaar and pays one on Base Sepolia — proof of a genuine external counterparty,
not self-dealing (the one thing a pure-Arc, self-authored entry can't show).

Verified live: paid **Node4All Fortune** ($0.002 USDC, x402 v2 exact scheme),
settled on-chain on Base Sepolia
([example tx](https://sepolia.basescan.org/tx/0xb6551b36f33e55a8491edb8ec0d56166d99086b4bfe4fca7fe70a6bb09c1c429)).
Uses the `@x402/core` v2 client (`x402HTTPClient` + `ExactEvmScheme`) — a
different rail (Coinbase facilitator) from the Circle Gateway batching on Arc.

## Run it

### Prerequisites
- Node.js v22+
- A cloud [Supabase](https://supabase.com) project (free) — the seller's payment ledger
- A [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) API key — routes the agent's LLM calls

### Setup
```bash
npm install
cp .env.example .env.local
npm run generate-wallets          # creates seller + buyer wallets in .env.local
# Fund the buyer at https://faucet.circle.com (Arc Testnet)
```
Then add to `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=...            # your Supabase project URL + keys
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
AI_GATEWAY_API_KEY=...                  # Vercel AI Gateway
```
Apply the SQL migrations in `supabase/migrations/` to your project (SQL Editor or `supabase db push`).
After a production deploy or database migration, run `npm run verify:production`
to smoke-check the live x402 challenge, wallet auth path, marketplace, stats,
agent topics, and public agent budget guard. Override the target with
`CRUX_VERIFY_BASE_URL=https://your-domain.example`.

### Commands
```bash
npm run dev                 # start the seller (marketplace + x402 endpoints)
npm run research-agent      # run the autonomous agent (brief + spend ledger + score)
npm run compare             # the money-shot: agent vs. baselines, side-by-side
npm run external-demo       # pay a REAL external x402 service on Base (via the Bazaar)
npm run verify:production   # smoke-check the deployed production app
```
Useful env overrides: `MODEL` (e.g. `anthropic/claude-opus-4.8`), `TOPIC`, `BUDGET`, `SEED`, `BASE_URL`.

## Tech & Circle products used

Next.js 16 · Vercel AI SDK v6 + AI Gateway · `@circle-fin/x402-batching`
(**Circle Gateway** batching + **Circle Nanopayments** on **Arc**) · x402 ·
Supabase · viem.

## Credits & license

This project **builds on Circle's reference implementation**
[`circlefin/arc-nanopayments`](https://github.com/circlefin/arc-nanopayments)
(Apache 2.0) for the x402 + Circle Gateway settlement layer on Arc — we fixed a
validity-window bug in it (the facilitator now requires a 7-day minimum that the
reference hardcoded shorter; see `lib/x402.ts`).

**Our contribution** is everything that makes it an *autonomous paying agent*: the
research-agent reasoning loop (`lib/agent.ts`), the marketplace decision space
(`lib/marketplace.ts`), the objective scorer (`lib/score.ts`), and the baseline
comparison (`lib/baseline.ts`, `compare.mts`).

Licensed under Apache 2.0 (see `LICENSE`).
