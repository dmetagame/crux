import { createClient } from "@supabase/supabase-js";
import { encryptUserWalletRows } from "../lib/wallet-backfill.ts";
import { hasWalletEncryptionKey } from "../lib/wallet-encryption.ts";

const dryRun = process.argv.includes("--dry-run");
const pageSize = Number.parseInt(process.env.CRUX_WALLET_BACKFILL_PAGE_SIZE ?? "100", 10);

if (!hasWalletEncryptionKey()) {
  throw new Error("Missing CRUX_WALLET_ENCRYPTION_KEY.");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

console.log(`${dryRun ? "Dry-run scanning" : "Encrypting"} visitor wallet keys...`);

const result = await encryptUserWalletRows(supabase, { dryRun, pageSize });

for (const failure of result.failures) {
  console.error(`FAIL ${failure}`);
}

console.log(
  `${dryRun ? "Would encrypt" : "Encrypted"} ${result.encrypted} ` +
    `wallet${result.encrypted === 1 ? "" : "s"}; scanned ${result.scanned}, ` +
    `skipped ${result.skipped}, failed ${result.failed}.`,
);

if (result.failed > 0) process.exit(1);
