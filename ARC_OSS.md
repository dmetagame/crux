# Arc Open Source Showcase Notes

Crux is an autonomous paying research agent, but the open-source value is the
set of reusable Arc payment primitives around it. Builders can fork the repo and
reuse the pieces independently: x402 seller routes, budget guards for paying
agents, visitor-funded wallets, durable run receipts, settlement reconciliation,
and agent discovery documents.

## Reusable Primitives

| Primitive | Where | What another Arc builder can reuse |
| --- | --- | --- |
| x402 + Circle Gateway seller wrapper | [`lib/x402.ts`](./lib/x402.ts) | Wrap a Next.js route so it returns HTTP 402 payment requirements, verifies a signed x402 payment, settles through Circle Gateway batching on Arc testnet, and records a payment event. |
| Paid resource routes | [`app/api/real/[source]/route.ts`](./app/api/real/[source]/route.ts), [`app/api/research/[id]/route.ts`](./app/api/research/[id]/route.ts), [`app/api/premium/*`](./app/api/premium) | Examples of x402-gated data/API endpoints with different prices and response shapes. |
| Budgeted paying-agent loop | [`lib/agent.ts`](./lib/agent.ts), [`lib/real-agent.ts`](./lib/real-agent.ts) | Tool-calling agent pattern where the model previews sources, checks remaining USDC budget, pays for selected sources, and stops when the task is sufficiently grounded. |
| Spend/rate guard for agent runners | [`lib/agent-access.ts`](./lib/agent-access.ts), [`lib/rate-limit.ts`](./lib/rate-limit.ts) | Fail-closed hourly limits, daily USDC budget caps, model allowlists, and concurrency locks for endpoints that can spend from a house wallet or visitor wallet. |
| Visitor-funded wallet lane | [`lib/wallet.ts`](./lib/wallet.ts), [`app/api/wallet/create/route.ts`](./app/api/wallet/create/route.ts), [`app/api/wallet/status/route.ts`](./app/api/wallet/status/route.ts) | Create Crux-hosted Arc testnet wallets, issue expiring capability tokens, check wallet/Gateway funding, and run agent jobs from a visitor-funded balance. |
| Encrypted wallet-key storage | [`lib/wallet-encryption.ts`](./lib/wallet-encryption.ts), [`scripts/encrypt-user-wallets.mts`](./scripts/encrypt-user-wallets.mts), [`supabase/migrations/20260310000009_encrypt_user_wallet_keys.sql`](./supabase/migrations/20260310000009_encrypt_user_wallet_keys.sql) | AES-256-GCM encryption/backfill pattern for testnet visitor wallet private keys stored in Supabase. |
| Durable run receipts | [`lib/run-receipts.ts`](./lib/run-receipts.ts), [`app/runs/[id]/page.tsx`](./app/runs/[id]/page.tsx), [`app/api/runs/[id]/route.ts`](./app/api/runs/[id]/route.ts) | Persist a public artifact for each paid agent run: budget, purchases, skips, rationales, result, benchmark score, and settlement proof. |
| Idempotent runner replay | [`lib/run-idempotency.ts`](./lib/run-idempotency.ts), [`lib/run-replay.ts`](./lib/run-replay.ts) | Avoid duplicate spend by replaying an existing receipt when a caller retries the same idempotency key. |
| Gateway facilitator evidence model | [`lib/settlement.ts`](./lib/settlement.ts), [`lib/settlement-verifier.ts`](./lib/settlement-verifier.ts), [`lib/payment-reconciliation.ts`](./lib/payment-reconciliation.ts) | Separate Circle Gateway references from Arc EVM transaction hashes, link ArcScan only for real tx hashes, retain facilitator requirements/verify/settle evidence, and reconcile stale proof metadata. |
| Operational smoke and fuel checks | [`scripts/verify-production.mts`](./scripts/verify-production.mts), [`scripts/check-production-fuel.mts`](./scripts/check-production-fuel.mts) | Repeatable checks for x402 challenges, wallet auth, public-run lockout, admin guards, and house/seller Gateway balances. |
| Agent discovery surface | [`app/.well-known/crux-agent.json/route.ts`](./app/.well-known/crux-agent.json/route.ts), [`app/openapi.json/route.ts`](./app/openapi.json/route.ts), [`AGENT_INTEGRATION.md`](./AGENT_INTEGRATION.md) | Machine-readable and human-readable docs so other agents can discover x402 resources, visitor-wallet auth, runner endpoints, and receipts. |

## What Crux Adds Beyond Circle Reference Repos

Crux builds on Circle's Apache-2.0
[`circlefin/arc-nanopayments`](https://github.com/circlefin/arc-nanopayments)
reference for x402 + Circle Gateway batching on Arc. The added reusable layer is
everything needed to make those payments safe and useful inside autonomous
agent products:

- **Spend judgment, not just payment execution:** the agent has a strict USDC
  budget, free previews, paid purchases, and an explicit stop condition.
- **Budget controls for production agents:** per-actor hourly limits, daily
  USDC caps, model allowlists, public-house-wallet lockout, and concurrency
  locks.
- **User-funded agent runs:** visitors or external agents can pay from their own
  Arc testnet wallet instead of draining a shared demo wallet.
- **Auditable receipts:** every completed run can become a public artifact with
  the payment ledger, model rationale, final output, and settlement proof.
- **Idempotent paid workflows:** retried runner requests replay previous
  receipts instead of spending twice.
- **Settlement proof hygiene:** Gateway references are modeled separately from
  Arc transaction hashes, with reconciliation and ArcScan links only when a real
  EVM hash exists.
- **Agent-to-agent discoverability:** OpenAPI and `.well-known` metadata make
  the paid resources callable by other agents, not only humans in the web UI.

## Forkable Builder Paths

Builders can reuse Crux at several levels:

1. **Use only the x402 wrapper:** copy `lib/x402.ts` and one route to turn a
   Next.js endpoint into a Circle Gateway-paid Arc resource.
2. **Use the runner guard:** copy `lib/agent-access.ts` and `lib/rate-limit.ts`
   to protect any endpoint that can spend a wallet.
3. **Use receipts:** copy the `run_receipts` schema and `lib/run-receipts.ts` to
   publish auditable artifacts for paid agent jobs.
4. **Use visitor wallets:** copy the wallet routes and encryption migration for
   self-funded testnet demos where every user becomes a distinct payer.
5. **Use discovery docs:** expose a `.well-known` manifest and OpenAPI spec so
   other agents can discover paid capabilities automatically.

## Live Reference Points

- Live app: https://crux-khaki.vercel.app
- Agent integration page: https://crux-khaki.vercel.app/agents
- Discovery manifest: https://crux-khaki.vercel.app/.well-known/crux-agent.json
- OpenAPI: https://crux-khaki.vercel.app/openapi.json
- Integration guide: [`AGENT_INTEGRATION.md`](./AGENT_INTEGRATION.md)
- Production smoke script: `npm run verify:production`

Golden receipts:

- Coinbase public-company run: https://crux-khaki.vercel.app/runs/6707c268-9a4e-4f9c-b197-e9e8f3ca410c
- OpenAI private-company run: https://crux-khaki.vercel.app/runs/e015e4c9-d14b-4e66-90e5-f3cb53e5924c
- Northwind scored benchmark: https://crux-khaki.vercel.app/runs/9859fecb-488b-478d-a5bc-fec3899d9229
- Agent-vs-baselines comparison: https://crux-khaki.vercel.app/runs/512afc48-1a8f-410d-89a4-64e63303b0f5
