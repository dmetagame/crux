import type { SupabaseClient } from "@supabase/supabase-js";
import { privateKeyToAccount } from "viem/accounts";
import {
  encryptWalletPrivateKey,
  isEncryptedWalletPrivateKey,
  walletEncryptionVersion,
} from "@/lib/wallet-encryption";
import type { HexPrivateKey } from "@/lib/wallet-keys";

type WalletRow = {
  id: string;
  address: string;
  private_key: string | null;
  private_key_ciphertext?: string | null;
};

export type WalletEncryptionBackfillResult = {
  scanned: number;
  encrypted: number;
  skipped: number;
  failed: number;
  failures: string[];
  dryRun: boolean;
};

export async function encryptUserWalletRows(
  supabase: SupabaseClient,
  opts: {
    dryRun?: boolean;
    pageSize?: number;
    maxRows?: number;
  } = {},
): Promise<WalletEncryptionBackfillResult> {
  const dryRun = opts.dryRun ?? false;
  const pageSize = Math.max(1, Math.min(Math.floor(opts.pageSize ?? 100), 500));
  const maxRows =
    typeof opts.maxRows === "number"
      ? Math.max(1, Math.floor(opts.maxRows))
      : Number.POSITIVE_INFINITY;

  const result: WalletEncryptionBackfillResult = {
    scanned: 0,
    encrypted: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    dryRun,
  };

  for (let from = 0; result.scanned < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, from + (maxRows - result.scanned) - 1);
    const { data, error } = await supabase
      .from("user_wallets")
      .select("id, address, private_key, private_key_ciphertext")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      if (/private_key_ciphertext/i.test(error.message)) {
        throw new Error("Apply the wallet encryption migration before running this backfill.");
      }
      throw new Error(`Could not load wallets: ${error.message}`);
    }

    const rows = (data ?? []) as WalletRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      result.scanned += 1;
      if (row.private_key_ciphertext) {
        result.skipped += 1;
        continue;
      }

      if (!row.private_key) {
        recordFailure(result, row.id, "missing key material");
        continue;
      }

      if (isEncryptedWalletPrivateKey(row.private_key)) {
        recordFailure(result, row.id, "encrypted key is stored in legacy column");
        continue;
      }

      const privateKey = row.private_key as HexPrivateKey;
      try {
        const derived = privateKeyToAccount(privateKey).address.toLowerCase();
        if (derived !== row.address.toLowerCase()) {
          throw new Error("private key does not match wallet address");
        }

        if (dryRun) {
          result.encrypted += 1;
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
        result.encrypted += 1;
      } catch (err) {
        recordFailure(result, row.id, (err as Error).message);
      }

      if (result.scanned >= maxRows) break;
    }

    if (rows.length < pageSize) break;
  }

  return result;
}

function recordFailure(
  result: WalletEncryptionBackfillResult,
  walletId: string,
  message: string,
) {
  result.failed += 1;
  result.failures.push(`${walletId}: ${message}`);
}
