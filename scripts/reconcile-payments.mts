import { createClient } from "@supabase/supabase-js";
import {
  paymentReconciliationAlertSummary,
  reconcilePayments,
} from "../lib/payment-reconciliation.ts";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const limit = readArgNumber("limit") ?? readEnvNumber("CRUX_RECONCILE_LIMIT");
const staleHours =
  readArgNumber("stale-hours") ?? readEnvNumber("CRUX_RECONCILE_STALE_HOURS");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const summary = await reconcilePayments(supabase, {
  dryRun,
  limit,
  staleHours,
});

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  console.error(paymentReconciliationAlertSummary(summary));
  process.exit(1);
}

function readArgNumber(name: string) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return undefined;
  return parseNumber(arg.slice(prefix.length));
}

function readEnvNumber(name: string) {
  return parseNumber(process.env[name]);
}

function parseNumber(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
