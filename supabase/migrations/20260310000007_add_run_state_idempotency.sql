-- Durable run state and idempotency for paid agent runs.
--
-- Receipt proof remains public through the sanitized app/API projections. New
-- rows can now start as running, finish as completed/failed, and be
-- de-duplicated by a scoped idempotency key so retries do not spend twice.

alter table public.run_receipts
  add column if not exists status text not null default 'completed'
    check (status in ('running', 'completed', 'failed')),
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists completed_at timestamptz,
  add column if not exists error text,
  add column if not exists idempotency_scope text,
  add column if not exists idempotency_key_hash text;

update public.run_receipts
set
  status = coalesce(status, 'completed'),
  started_at = coalesce(started_at, created_at),
  completed_at = coalesce(completed_at, created_at)
where status is null
   or started_at is null
   or (status = 'completed' and completed_at is null);

create unique index if not exists run_receipts_idempotency_unique_idx
  on public.run_receipts (idempotency_scope, idempotency_key_hash)
  where idempotency_key_hash is not null;

create index if not exists run_receipts_status_created_at_idx
  on public.run_receipts (status, created_at desc);

drop policy if exists "Allow service updates"
  on public.run_receipts;

create policy "Allow service updates"
  on public.run_receipts for update
  to service_role
  using (true);
