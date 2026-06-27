-- Email-backed visitor wallets are recoverable: the same normalized email
-- should always resolve to the same custodial testnet wallet.

create unique index if not exists user_wallets_email_unique_idx
  on public.user_wallets (email)
  where email is not null;
