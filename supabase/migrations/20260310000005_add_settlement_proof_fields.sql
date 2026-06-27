-- Store the strongest settlement proof Crux has for each x402 payment.
--
-- Circle Gateway batching may return either a normal EVM transaction hash or a
-- Gateway settlement reference. Only real 0x transaction hashes can be linked
-- to ArcScan and independently confirmed through Arc RPC.

alter table public.payment_events
  add column if not exists settlement_reference text,
  add column if not exists settlement_kind text not null default 'none'
    check (settlement_kind in ('arc_tx_hash', 'gateway_settlement_reference', 'none')),
  add column if not exists settlement_status text not null default 'recorded'
    check (settlement_status in ('arc_confirmed', 'arc_failed', 'arc_unverified', 'gateway_settled', 'recorded')),
  add column if not exists arc_tx_hash text,
  add column if not exists arc_chain_id integer,
  add column if not exists arc_block_number bigint,
  add column if not exists arc_confirmed_at timestamptz,
  add column if not exists settlement_checked_at timestamptz;

update public.payment_events
set
  settlement_reference = coalesce(settlement_reference, gateway_tx),
  settlement_kind = case
    when coalesce(settlement_reference, gateway_tx) ~ '^0x[0-9a-fA-F]{64}$' then 'arc_tx_hash'
    when nullif(coalesce(settlement_reference, gateway_tx), '') is not null then 'gateway_settlement_reference'
    else 'none'
  end,
  settlement_status = case
    when coalesce(settlement_reference, gateway_tx) ~ '^0x[0-9a-fA-F]{64}$' then 'arc_unverified'
    when nullif(coalesce(settlement_reference, gateway_tx), '') is not null then 'gateway_settled'
    else 'recorded'
  end,
  arc_tx_hash = case
    when coalesce(settlement_reference, gateway_tx) ~ '^0x[0-9a-fA-F]{64}$'
      then coalesce(settlement_reference, gateway_tx)
    else arc_tx_hash
  end,
  arc_chain_id = case
    when coalesce(settlement_reference, gateway_tx) ~ '^0x[0-9a-fA-F]{64}$'
      then 5042002
    else arc_chain_id
  end
where settlement_reference is null
   or settlement_kind = 'none'
   or settlement_status = 'recorded';

create index if not exists payment_events_settlement_kind_created_at_idx
  on public.payment_events (settlement_kind, created_at desc);

create index if not exists payment_events_arc_tx_hash_idx
  on public.payment_events (arc_tx_hash)
  where arc_tx_hash is not null;
