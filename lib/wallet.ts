/**
 * User-funded wallet lane (optional, additive).
 *
 * The default Crux demo pays from a shared house wallet (BUYER_PRIVATE_KEY) so a
 * visitor can watch real settlements with zero friction. This module adds an
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

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface NewWallet {
  walletId: string;
  address: `0x${string}`;
}

/** Generate a fresh testnet wallet, persist it, and return its id + address. */
export async function createUserWallet(email: string | null): Promise<NewWallet> {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;

  const { data, error } = await admin()
    .from("user_wallets")
    .insert({ email: email || null, address, private_key: privateKey })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create wallet: ${error.message}`);
  return { walletId: data.id as string, address };
}

/** Resolve a walletId to its private key (server-side only). Null if unknown. */
export async function getWalletKey(
  walletId: string,
): Promise<{ key: `0x${string}`; address: string } | null> {
  const { data, error } = await admin()
    .from("user_wallets")
    .select("address, private_key")
    .eq("id", walletId)
    .single();

  if (error || !data) return null;
  return { key: data.private_key as `0x${string}`, address: data.address as string };
}

/** Count of onboarded wallets — an honest, non-gameable traction signal. */
export async function countUserWallets(): Promise<number> {
  const { count } = await admin()
    .from("user_wallets")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}
