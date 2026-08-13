-- Public receipt proof is served through /runs/:id and /api/runs/:id, where
-- legacy and degraded payloads are sanitized before exposure. Direct anonymous
-- reads of the raw storage table would bypass that public projection.

drop policy if exists "Allow public read access"
  on public.run_receipts;
