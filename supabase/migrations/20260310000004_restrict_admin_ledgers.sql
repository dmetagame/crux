-- Ledger tables back admin-only dashboard/API routes. Public traction remains
-- available through /api/stats, and public run artifacts remain in run_receipts.

drop policy if exists "Allow public read access"
  on public.payment_events;

drop policy if exists "Allow public read access"
  on public.withdrawals;
