-- Prepare visitor wallets for app-level private-key encryption.
--
-- Existing rows keep their legacy plaintext private_key until the app-side
-- backfill encrypts them with CRUX_WALLET_ENCRYPTION_KEY. New encrypted rows
-- store ciphertext here and leave private_key null.

alter table public.user_wallets
  add column if not exists private_key_ciphertext text,
  add column if not exists private_key_encryption_version integer,
  add column if not exists private_key_encrypted_at timestamptz;

alter table public.user_wallets
  alter column private_key drop not null;

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
      check (private_key is not null or private_key_ciphertext is not null)
      not valid;
  end if;
end
$$;

alter table public.user_wallets
  validate constraint user_wallets_has_key_material;

create index if not exists user_wallets_unencrypted_key_idx
  on public.user_wallets (created_at, id)
  where private_key is not null
    and private_key_ciphertext is null;

comment on column public.user_wallets.private_key is
  'Legacy plaintext testnet wallet key. Cleared by scripts/encrypt-user-wallets.mts after private_key_ciphertext is written.';

comment on column public.user_wallets.private_key_ciphertext is
  'AES-256-GCM app-level encrypted testnet wallet key. Encryption key lives outside Supabase in CRUX_WALLET_ENCRYPTION_KEY.';
