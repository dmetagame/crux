-- Public, shareable proof artifacts for completed Crux agent runs.
--
-- A receipt captures the agent's budget, source decisions, final brief, score
-- when available, and Arc settlement references. These pages are intentionally
-- public: they are the async judging and traction artifact.

create table if not exists public.run_receipts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  mode        text not null check (mode in ('real', 'benchmark')),
  subject     text not null,
  model       text,
  budget_usdc numeric,
  spent_usdc  numeric,
  payer_kind  text not null default 'house-wallet',
  payload     jsonb not null
);

create index if not exists run_receipts_created_at_idx on public.run_receipts (created_at desc);
create index if not exists run_receipts_mode_created_at_idx on public.run_receipts (mode, created_at desc);

alter table public.run_receipts enable row level security;

create policy "Allow public read access"
  on public.run_receipts for select
  using (true);

create policy "Allow service inserts"
  on public.run_receipts for insert
  to service_role
  with check (true);
