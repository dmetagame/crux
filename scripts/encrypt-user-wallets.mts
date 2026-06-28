import { createClient } from "@supabase/supabase-js";
import { privateKeyToAccount } from "viem/accounts";
import {
  encryptWalletPrivateKey,
  hasWalletEncryptionKey,
  isEncryptedWalletPrivateKey,
  walletEncryptionVersion,
} from "../lib/wallet-encryption.ts";
import type { HexPrivateKey } from "../lib/wallet-keys.ts";

type WalletRow = {
  id: string;
  address: string;
  private_key: string | null;
  private_key_ciphertext?: string | null;
};

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

let scanned = 0;
let encrypted = 0;
let skipped = 0;
let failed = 0;

console.log(`${dryRun ? "Dry-run scanning" : "Encrypting"} visitor wallet keys...`);

for (let from = 0; ; from += pageSize) {
  const { data, error } = await supabase
    .from("user_wallets")
    .select("id, address, private_key, private_key_ciphertext")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + pageSize - 1);

  if (error) {
    if (/private_key_ciphertext/i.test(error.message)) {
      throw new Error("Apply the wallet encryption migration before running this backfill.");
    }
    throw new Error(`Could not load wallets: ${error.message}`);
  }

  const rows = (data ?? []) as WalletRow[];
  if (rows.length === 0) break;

  for (const row of rows) {
    scanned += 1;
    if (row.private_key_ciphertext) {
      skipped += 1;
      continue;
    }

    if (!row.private_key) {
      failed += 1;
      console.error(`FAIL ${row.id}: missing key material`);
      continue;
    }

    if (isEncryptedWalletPrivateKey(row.private_key)) {
      failed += 1;
      console.error(`FAIL ${row.id}: encrypted key is stored in legacy column`);
      continue;
    }

    const privateKey = row.private_key as HexPrivateKey;
    try {
      const derived = privateKeyToAccount(privateKey).address.toLowerCase();
      if (derived !== row.address.toLowerCase()) {
        throw new Error("private key does not match wallet address");
      }

      if (dryRun) {
        encrypted += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("user_wallets")
        .update({
          private_key: null,
          private_key_ciphertext: encryptWalletPrivateKey(privateKey),
          private_key_encryption_version: walletEncryptionVersion(),
          private_key_encrypted_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .is("private_key_ciphertext", null);

      if (updateError) throw updateError;
      encrypted += 1;
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${row.id}: ${(err as Error).message}`);
    }
  }

  if (rows.length < pageSize) break;
}

console.log(
  `${dryRun ? "Would encrypt" : "Encrypted"} ${encrypted} wallet${encrypted === 1 ? "" : "s"}; ` +
    `scanned ${scanned}, skipped ${skipped}, failed ${failed}.`,
);

if (failed > 0) process.exit(1);
