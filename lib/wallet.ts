/**
 * User-funded wallet lane (optional, additive).
 *
 * Operator and trusted-agent runs can pay from a shared house testnet wallet.
 * Public hands-on runs use this lane: a visitor gets an Arc *testnet* wallet,
 * funds it at faucet.circle.com, and pays for research from it — so it shows up
 * as a genuinely distinct payer in the traction counter (payment_events.payer is
 * the buyer address), not another payment from the house wallet.
 *
 * The wallets are custodial and hold only testnet USDC. Keys live in Supabase and
 * are read with the service-role key on the server only — never sent to the browser.
 */
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { randomToken, safeEqualHex, sha256Hex } from "@/lib/access-crypto";
import {
  decryptWalletPrivateKey,
  encryptWalletPrivateKey,
  hasWalletEncryptionKey,
  isEncryptedWalletPrivateKey,
  shouldRequireEncryptedWallets,
  walletEncryptionVersion,
} from "@/lib/wallet-encryption";
import type { HexPrivateKey } from "@/lib/wallet-keys";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface NewWallet {
  walletId: string;
  address: `0x${string}`;
  walletToken: string;
}

export async function createUserWallet(): Promise<NewWallet> {
  if (shouldRequireEncryptedWallets() && !hasWalletEncryptionKey()) {
    throw new Error("Visitor wallet creation is unavailable until wallet encryption is configured.");
  }

  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  const walletToken = randomToken();
  const keyColumns = walletKeyColumns(privateKey);

  let { data, error } = await admin()
    .from("user_wallets")
    .insert({
      email: null,
      address,
      ...keyColumns,
      wallet_token_hash: sha256Hex(walletToken),
      wallet_token_created_at: new Date().toISOString(),
    })
    .select("id, address")
    .single();

  if (error && isRequiredWalletColumnError(error.message)) {
    throw new Error(
      "Could not create a secure wallet: apply all Supabase migrations first.",
    );
  }

  if (error) throw new Error(`Could not create wallet: ${error.message}`);
  if (!data) throw new Error("Could not create wallet: empty database response");
  return { walletId: data.id as string, address: data.address as `0x${string}`, walletToken };
}

/** Resolve a walletId to its private key (server-side only). Null if unknown. */
export async function getWalletKey(
  walletId: string,
  walletToken?: string | null,
): Promise<{ key: `0x${string}`; address: string } | null> {
  const tokenQuery = await admin()
    .from("user_wallets")
    .select("address, private_key, private_key_ciphertext, wallet_token_hash, wallet_token_created_at")
    .eq("id", walletId)
    .single();
  const data = tokenQuery.data;
  if (tokenQuery.error || !data) return null;

  const supplied = walletToken?.trim();
  const tokenHash = data.wallet_token_hash as string | null;
  const tokenCreatedAt = data.wallet_token_created_at as string | null;
  if (!supplied || !tokenHash || !tokenCreatedAt) return null;
  if (!safeEqualHex(tokenHash, sha256Hex(supplied))) return null;
  if (walletTokenExpired(tokenCreatedAt)) return null;

  const key = resolveStoredWalletKey(data);
  const derivedAddress = privateKeyToAccount(key).address;
  if (getAddress(derivedAddress) !== getAddress(data.address as string)) {
    throw new Error("Stored wallet address does not match its encrypted key.");
  }
  return { key, address: derivedAddress };
}

/** Count of onboarded wallets — an honest, non-gameable traction signal. */
export async function countUserWallets(): Promise<number> {
  const { count } = await admin()
    .from("user_wallets")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}

function walletKeyColumns(privateKey: HexPrivateKey) {
  if (!hasWalletEncryptionKey()) {
    if (shouldRequireEncryptedWallets()) {
      throw new Error("Missing CRUX_WALLET_ENCRYPTION_KEY.");
    }
    return { private_key: privateKey };
  }

  return {
    private_key: null,
    private_key_ciphertext: encryptWalletPrivateKey(privateKey),
    private_key_encryption_version: walletEncryptionVersion(),
    private_key_encrypted_at: new Date().toISOString(),
  };
}

function resolveStoredWalletKey(data: {
  private_key?: string | null;
  private_key_ciphertext?: string | null;
}): HexPrivateKey {
  if (data.private_key_ciphertext) {
    return decryptWalletPrivateKey(data.private_key_ciphertext);
  }

  const plaintext = data.private_key;
  if (!plaintext) {
    throw new Error("Wallet key material is missing.");
  }

  if (isEncryptedWalletPrivateKey(plaintext)) {
    return decryptWalletPrivateKey(plaintext);
  }

  if (shouldRequireEncryptedWallets()) {
    throw new Error("Wallet key has not been encrypted yet.");
  }

  return plaintext as HexPrivateKey;
}

function walletTokenExpired(createdAt: string) {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return true;
  const maxAgeSeconds = Math.max(
    300,
    Number.parseInt(process.env.CRUX_WALLET_TOKEN_MAX_AGE_SECONDS ?? "604800", 10) || 604800,
  );
  return Date.now() - created > maxAgeSeconds * 1000;
}

function isRequiredWalletColumnError(message: string) {
  return /private_key_ciphertext|private_key_encryption_version|private_key_encrypted_at|wallet_token_hash|wallet_token_created_at/i.test(
    message,
  );
}
