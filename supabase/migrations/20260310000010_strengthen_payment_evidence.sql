-- Preserve exact x402 amounts and the facilitator evidence used to accept each
-- payment. A Circle Gateway reference proves that the facilitator accepted the
-- batched payment; it is not necessarily an independently confirmed Arc tx.

alter table public.payment_events
  add column if not exists amount_atomic text,
  add column if not exists facilitator_requirements jsonb,
  add column if not exists facilitator_verify jsonb,
  add column if not exists facilitator_settle jsonb;

update public.payment_events
set amount_atomic = round(amount_usdc::numeric * 1000000)::bigint::text
where amount_atomic is null
  and amount_usdc ~ '^\d+(\.\d+)?$';

alter table public.payment_events
  alter column settlement_status set default 'recorded';

alter table public.payment_events
  drop constraint if exists payment_events_settlement_status_check;

update public.payment_events
set settlement_status = 'gateway_reference_recorded'
where settlement_status = 'gateway_settled';

alter table public.payment_events
  add constraint payment_events_settlement_status_check
  check (settlement_status in (
    'arc_confirmed',
    'arc_failed',
    'arc_unverified',
    'gateway_reference_recorded',
    'recorded'
  ));

create index if not exists payment_events_amount_atomic_created_at_idx
  on public.payment_events (amount_atomic, created_at desc);

-- Wallet creation is intentionally one-time and capability-token based. Email
-- is no longer a recovery credential, so remove the historical uniqueness rule.
drop index if exists public.user_wallets_email_unique_idx;
