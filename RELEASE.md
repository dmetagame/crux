# Production Release Checklist

Use this checklist for every production release. Crux has two deploy surfaces:
Vercel for the app and Supabase SQL for schema/RPC changes. Treat them as one
release.

## Before Deploy

1. Confirm CI is green for the commit being released.
2. Run local checks when the change is high risk:
   ```bash
   npm run check:migrations
   npm run lint
   NEXT_PUBLIC_SUPABASE_URL=http://localhost NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy SUPABASE_SERVICE_ROLE_KEY=dummy npm run build
   ```
3. If `supabase/migrations/` changed, run:
   ```bash
   npm run verify:migrations
   ```
4. Run the strict release preflight with production wallet and AI Gateway
   credentials loaded:
   ```bash
   npm run check:release
   ```
   It exits nonzero for core blockers, checks the production API and x402
   challenge, models the exact automatic Gateway-deposit threshold, and
   performs a bounded no-payment tool loop through the real model/fallback
   route. External-payer proof and seller withdrawal gas are warnings because
   neither blocks the core RFB-01
   product. `--skip-ai` is available only for non-agent infrastructure releases.
   A free-tier AI route can pass once and rate-limit the next call; treat any
   failure as a real judging-window blocker and add paid Gateway credits rather
   than weakening the check.
5. A minimal AI probe cannot guarantee a complete multi-step tool loop. Before
   a live judging window, also run one capped operator/trusted-agent journey and
   inspect its durable receipt.

## Database Release Step

If the release includes a new Supabase migration:

1. Apply only the new migration SQL files, in filename order, to production
   Supabase using SQL Editor or `supabase db push`.
2. Record the applied migration filename(s) in the PR/release notes.
3. Do not promote the app as complete until the SQL editor returns success.

## App Deploy

Deploy the exact commit that passed CI:

```bash
npx vercel@latest --prod --yes --scope dmetagames-projects
```

## After Deploy

Confirm production alerting is configured when the release changes payment,
agent, rate-limit, or receipt behavior:

```bash
npx vercel@latest env ls --scope dmetagames-projects | grep CRUX_ALERT_WEBHOOK_URL
```

If alert destinations were added or rotated, set a short-lived
`CRUX_MAINTENANCE_TOKEN`, redeploy, then verify delivery:

```bash
CRUX_MAINTENANCE_TOKEN=... npm run alerts:test
```

For payment/settlement changes, run a dry reconciliation before deploy when
production Supabase env vars are loaded:

```bash
npm run reconcile:payments -- --dry-run
```

Confirm `CRON_SECRET` is set in production; `/api/admin/reconcile-payments`
requires `Authorization: Bearer $CRON_SECRET` or `CRUX_MAINTENANCE_TOKEN`.

If enabling or rotating the seller dashboard, set `ADMIN_SESSION_SECRET` and
prefer `ADMIN_PASSWORD_SHA256` over plaintext `ADMIN_PASSWORD`, then redeploy.

Run the smoke check:

```bash
npm run verify:production
```

Before a live judging window, complete one capped operator or trusted-agent run
and open its receipt. Treat a completed receipt with model metadata and payment
evidence as the AI-path fuel check; a single minimal model response is not enough.

Then inspect recent Vercel warnings:

```bash
npx vercel@latest logs crux-khaki.vercel.app --scope dmetagames-projects --since 5m --level warning --expand --limit 20
```

The release is complete only when the smoke check passes and there are no new
unexpected warnings.

## External Proof Drills

Verify a third party's direct x402 payment before adding it to the explicit
production allowlist:

```bash
npm run verify:external-payment -- \
  --payer 0xIndependentPayer \
  --proof https://crux-khaki.vercel.app/api/payments/by-reference/reference \
  --attest-independent
```

The command verifies Circle facilitator evidence, Arc network, Crux endpoint,
amount cap, current seller, and that the payer is not a Crux house, seller, or
hosted visitor wallet. The explicit attestation records the remaining social
fact that code cannot prove: a genuinely separate person or project controls
the payer. The command never edits Vercel or attributes an address itself.

Check the visitor judge path without spending:

```bash
chmod 600 /tmp/crux-visitor-proof.json
npm run verify:visitor -- --credentials /tmp/crux-visitor-proof.json
```

Only add `--execute` when intentionally running one capped paid production
journey. If the AI provider fails after a purchase, the command verifies and
prints the retained failed-run receipt instead of retrying and risking duplicate
spend.

## Secret Changes

When adding or rotating Vercel secrets, redeploy after the env change. Remove
short-lived maintenance secrets after use and redeploy once more so the runtime
no longer has them.
