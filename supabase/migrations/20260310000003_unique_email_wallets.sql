-- Email-backed visitor wallets are recoverable: the same normalized email
-- should always resolve to the same custodial testnet wallet.

create table if not exists public.user_wallets (
  id uuid primary key default gen_random_uuid(),
  email text,
  address text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

alter table public.user_wallets enable row level security;

update public.user_wallets
set email = lower(trim(email))
where email is not null
  and email <> lower(trim(email));

-- Keep one canonical row per email and preserve the duplicate wallet rows by
-- clearing only their email label. Prefer wallets that have actually settled a
-- payment, then the oldest generated wallet.
with ranked as (
  select
    uw.id,
    row_number() over (
      partition by uw.email
      order by
        exists (
          select 1
          from public.payment_events pe
          where lower(pe.payer) = lower(uw.address)
        ) desc,
        uw.created_at asc,
        uw.id asc
    ) as rn
  from public.user_wallets uw
  where uw.email is not null
)
update public.user_wallets uw
set email = null
from ranked r
where uw.id = r.id
  and r.rn > 1;

create unique index if not exists user_wallets_email_unique_idx
  on public.user_wallets (email)
  where email is not null;
