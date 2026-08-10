-- Crux user-funded wallets (optional onboarding lane).
--
-- Each row is a custodial TESTNET wallet generated for a visitor who wants to
-- pay for research from their OWN wallet (faucet'd by them at faucet.circle.com)
-- instead of the shared house wallet. These hold only Arc *testnet* USDC and are
-- never used for anything but x402 nanopayments — but they are still custodial,
-- so key material must stay server-side and should be encrypted by the app
-- before storage with CRUX_WALLET_ENCRYPTION_KEY.
--
-- Run once in the Supabase SQL editor.

create table if not exists public.user_wallets (
  id          uuid primary key default gen_random_uuid(),
  email       text,
  address     text not null,
  private_key text,
  private_key_ciphertext text,
  private_key_encryption_version integer,
  private_key_encrypted_at timestamptz,
  created_at  timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_wallets_has_key_material'
      and conrelid = 'public.user_wallets'::regclass
  ) then
    alter table public.user_wallets
      add constraint user_wallets_has_key_material
      check (private_key is not null or private_key_ciphertext is not null);
  end if;
end
$$;

-- Distinct-payer / onboarding signal reads this; keep lookups fast.
create index if not exists user_wallets_created_at_idx on public.user_wallets (created_at desc);
drop index if exists public.user_wallets_email_unique_idx;

-- Service-role only (the server uses the service-role key). No anon access:
-- key columns must never be exposed to the browser.
alter table public.user_wallets enable row level security;
