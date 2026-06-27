-- Crux user-funded wallets (optional onboarding lane).
--
-- Each row is a custodial TESTNET wallet generated for a visitor who wants to
-- pay for research from their OWN wallet (faucet'd by them at faucet.circle.com)
-- instead of the shared house wallet. These hold only Arc *testnet* USDC and are
-- never used for anything but x402 nanopayments — but they are still custodial,
-- so the key column must stay server-side (service-role only) and never leave the DB.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.user_wallets (
  id          uuid primary key default gen_random_uuid(),
  email       text,
  address     text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);

-- Distinct-payer / onboarding signal reads this; keep lookups fast.
create index if not exists user_wallets_created_at_idx on public.user_wallets (created_at desc);

-- Service-role only (the server uses the service-role key). No anon access:
-- the private_key column must never be exposed to the browser.
alter table public.user_wallets enable row level security;
