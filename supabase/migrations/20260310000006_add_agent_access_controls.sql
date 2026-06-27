-- Agent access controls for public/demo runner endpoints.
--
-- x402-paid resource endpoints remain payment-native. These tables/functions
-- protect routes that spend the house wallet, create custodial visitor wallets,
-- or consume server-side LLM/runtime resources.

create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.rate_limits enable row level security;

create table if not exists public.run_locks (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.run_locks enable row level security;

create index if not exists run_locks_key_expires_at_idx
  on public.run_locks (key, expires_at);

create table if not exists public.user_wallets (
  id uuid primary key default gen_random_uuid(),
  email text,
  address text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

alter table public.user_wallets enable row level security;

alter table public.user_wallets
  add column if not exists wallet_token_hash text,
  add column if not exists wallet_token_created_at timestamptz;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer,
  p_cost integer default 1
)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  row_data public.rate_limits%rowtype;
  next_count integer;
  current_window_start timestamptz;
  current_reset_at timestamptz;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'rate limit key is required';
  end if;
  if p_limit < 1 or p_window_seconds < 1 or p_cost < 1 then
    raise exception 'invalid rate limit arguments';
  end if;

  loop
    select *
      into row_data
      from public.rate_limits
      where key = p_key
      for update;

    if not found then
      begin
        insert into public.rate_limits (key, window_start, count, updated_at)
        values (p_key, now_ts, p_cost, now_ts);
        allowed := p_cost <= p_limit;
        remaining := greatest(p_limit - p_cost, 0);
        reset_at := now_ts + make_interval(secs => p_window_seconds);
        return next;
      exception when unique_violation then
        -- Another request inserted the row between SELECT and INSERT.
      end;
    else
      current_window_start := row_data.window_start;
      if row_data.window_start + make_interval(secs => p_window_seconds) <= now_ts then
        current_window_start := now_ts;
        row_data.count := 0;
      end if;

      current_reset_at := current_window_start + make_interval(secs => p_window_seconds);
      next_count := row_data.count + p_cost;

      if next_count > p_limit then
        update public.rate_limits
          set window_start = current_window_start,
              count = row_data.count,
              updated_at = now_ts
          where key = p_key;
        allowed := false;
        remaining := greatest(p_limit - row_data.count, 0);
        reset_at := current_reset_at;
        return next;
      end if;

      update public.rate_limits
        set window_start = current_window_start,
            count = next_count,
            updated_at = now_ts
        where key = p_key;
      allowed := true;
      remaining := greatest(p_limit - next_count, 0);
      reset_at := current_reset_at;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.try_acquire_run_lock(
  p_key text,
  p_limit integer,
  p_ttl_seconds integer
)
returns table(acquired boolean, active_count integer, reset_at timestamptz, lock_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  active integer;
  new_lock_id uuid;
  expires timestamptz;
begin
  if p_key is null or length(p_key) = 0 then
    raise exception 'lock key is required';
  end if;
  if p_limit < 1 or p_ttl_seconds < 1 then
    raise exception 'invalid run lock arguments';
  end if;

  delete from public.run_locks
    where key = p_key
      and expires_at <= now_ts;

  select count(*)
    into active
    from public.run_locks
    where key = p_key
      and expires_at > now_ts;

  if active >= p_limit then
    select min(expires_at)
      into expires
      from public.run_locks
      where key = p_key
        and expires_at > now_ts;
    acquired := false;
    active_count := active;
    reset_at := expires;
    lock_id := null;
    return next;
  end if;

  insert into public.run_locks (key, expires_at)
    values (p_key, now_ts + make_interval(secs => p_ttl_seconds))
    returning id, expires_at into new_lock_id, expires;

  acquired := true;
  active_count := active + 1;
  reset_at := expires;
  lock_id := new_lock_id;
  return next;
end;
$$;

create or replace function public.release_run_lock(p_lock_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.run_locks where id = p_lock_id;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer, integer) from public;
revoke all on function public.try_acquire_run_lock(text, integer, integer) from public;
revoke all on function public.release_run_lock(uuid) from public;

grant execute on function public.consume_rate_limit(text, integer, integer, integer) to service_role;
grant execute on function public.try_acquire_run_lock(text, integer, integer) to service_role;
grant execute on function public.release_run_lock(uuid) to service_role;
