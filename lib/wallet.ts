/**
 * User-funded wallet lane (optional, additive).
 *
 * The default Crux demo pays from a shared house testnet wallet so a visitor
 * can watch real settlements with zero friction. This module adds an
 * OPT-IN path: a visitor gets their own generated Arc *testnet* wallet, funds it
 * themselves at faucet.circle.com, and pays for research from it — so it shows up
 * as a genuinely distinct payer in the traction counter (payment_events.payer is
 * the buyer address), not another payment from the house wallet.
 *
 * The wallets are custodial and hold only testnet USDC. Keys live in Supabase and
 * are read with the service-role key on the server only — never sent to the browser.
 */
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { randomToken, safeEqualHex, sha256Hex } from "@/lib/access-crypto";

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

async function findWalletByEmail(
  email: string,
): Promise<{ walletId: string; address: `0x${string}` } | null> {
  const { data, error } = await admin()
    .from("user_wallets")
    .select("id, address")
    .eq("email", email)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);

  if (error) throw new Error(`Could not look up wallet: ${error.message}`);
  const existing = data?.[0];
  if (!existing) return null;
  return { walletId: existing.id as string, address: existing.address as `0x${string}` };
}

/**
 * Return the existing wallet for an email, or create one if it does not exist.
 * Anonymous calls always create a fresh testnet wallet.
 */
export async function createUserWallet(email: string | null): Promise<NewWallet> {
  const normalizedEmail = email?.trim().toLowerCase() || null;
  if (normalizedEmail) {
    const existing = await findWalletByEmail(normalizedEmail);
    if (existing) {
      return { ...existing, walletToken: await issueWalletToken(existing.walletId) };
    }
  }

  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  const walletToken = randomToken();

  let { data, error } = await admin()
    .from("user_wallets")
    .insert({
      email: normalizedEmail,
      address,
      private_key: privateKey,
      wallet_token_hash: sha256Hex(walletToken),
      wallet_token_created_at: new Date().toISOString(),
    })
    .select("id, address")
    .single();

  if (error && /wallet_token_hash|wallet_token_created_at/i.test(error.message)) {
    const fallback = await admin()
      .from("user_wallets")
      .insert({ email: normalizedEmail, address, private_key: privateKey })
      .select("id, address")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error && normalizedEmail && /duplicate|unique/i.test(error.message)) {
    const existing = await findWalletByEmail(normalizedEmail);
    if (existing) {
      return { ...existing, walletToken: await issueWalletToken(existing.walletId) };
    }
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
    .select("address, private_key, wallet_token_hash")
    .eq("id", walletId)
    .single();
  let data: any | null = tokenQuery.data;
  let error = tokenQuery.error;

  if (error && /wallet_token_hash/i.test(error.message)) {
    const fallback = await admin()
      .from("user_wallets")
      .select("address, private_key")
      .eq("id", walletId)
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error || !data) return null;
  const tokenHash = (data as { wallet_token_hash?: string | null }).wallet_token_hash;
  if (tokenHash) {
    const supplied = walletToken?.trim();
    if (!supplied || !safeEqualHex(tokenHash, sha256Hex(supplied))) return null;
  }
  return { key: data.private_key as `0x${string}`, address: data.address as string };
}

/** Count of onboarded wallets — an honest, non-gameable traction signal. */
export async function countUserWallets(): Promise<number> {
  const { count } = await admin()
    .from("user_wallets")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}

async function issueWalletToken(walletId: string) {
  const walletToken = randomToken();
  const { error } = await admin()
    .from("user_wallets")
    .update({
      wallet_token_hash: sha256Hex(walletToken),
      wallet_token_created_at: new Date().toISOString(),
    })
    .eq("id", walletId);

  if (error && !/wallet_token_hash|wallet_token_created_at/i.test(error.message)) {
    throw new Error(`Could not issue wallet token: ${error.message}`);
  }

  return walletToken;
}
