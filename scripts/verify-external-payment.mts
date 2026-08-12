import { createClient } from "@supabase/supabase-js";
import { getAddress, isAddress } from "viem";
import {
  proofReferenceFromUrl,
  verifyExternalPaymentProof,
} from "../lib/external-payment-proof.ts";
import {
  getHistoricalHouseAddresses,
  getHouseAddress,
  getSellerAddress,
} from "../lib/wallet-keys.ts";

const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizedUrl(
  process.env.CRUX_BASE_URL ?? "https://crux-khaki.vercel.app",
  "CRUX_BASE_URL",
);
const payerInput = args.payer ?? process.env.CRUX_EXTERNAL_PAYER_ADDRESS?.trim();
const proofInput = args.proof ?? process.env.CRUX_EXTERNAL_PROOF_URL?.trim();

if (!payerInput || !isAddress(payerInput)) {
  fail("Pass a valid payer with --payer 0x... or CRUX_EXTERNAL_PAYER_ADDRESS.");
}
if (!proofInput) {
  fail("Pass the public Crux proof URL with --proof URL or CRUX_EXTERNAL_PROOF_URL.");
}

const payer = getAddress(payerInput);
const proofUrl = normalizedUrl(proofInput, "proof URL");
const reference = proofReferenceFromUrl(proofUrl, baseUrl);
assertIndependentAddress(payer);
await assertNotVisitorWallet(payer);

const response = await fetch(proofUrl, {
  cache: "no-store",
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  fail(`Crux proof endpoint returned HTTP ${response.status}.`);
}

const verified = verifyExternalPaymentProof({
  body: await response.json(),
  expectedPayer: payer,
  expectedReference: reference,
  expectedPayTo: getSellerAddress(),
});

console.log("PASS independent payer address is not a Crux house, seller, or visitor wallet");
console.log("PASS Circle facilitator verification and settlement both succeeded");
console.log(`PASS ${verified.amountAtomic} atomic USDC paid ${verified.endpoint} on Arc Testnet`);
console.log(`PASS settlement reference ${verified.settlementReference}`);
console.log("");
if (!args.attestIndependent) {
  fail(
    "Technical proof passed, but --attest-independent is required to confirm the payer is controlled by a genuinely separate person or project.",
  );
}
console.log("PASS maintainer attested that a separate person or project controls this payer");
console.log("Verified, but not attributed automatically.");
console.log(`Add ${verified.payer} to CRUX_EXTERNAL_X402_PAYER_ADDRESSES, redeploy, then confirm /api/stats increments independentExternalPayers.`);

function assertIndependentAddress(address: string) {
  const blocked = new Set<string>();
  try {
    blocked.add(getHouseAddress().toLowerCase());
    for (const historical of getHistoricalHouseAddresses()) {
      blocked.add(historical.toLowerCase());
    }
  } catch (error) {
    fail(`Could not validate house-wallet independence: ${(error as Error).message}`);
  }
  try {
    blocked.add(getSellerAddress().toLowerCase());
  } catch (error) {
    fail(`Could not validate seller-wallet independence: ${(error as Error).message}`);
  }
  if (blocked.has(address.toLowerCase())) {
    fail("Payer is controlled by Crux and cannot be classified as independent.");
  }
}

async function assertNotVisitorWallet(address: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRole) {
    fail("Supabase admin credentials are required to rule out a Crux-hosted visitor wallet.");
  }

  const { data, error } = await createClient(supabaseUrl, serviceRole)
    .from("user_wallets")
    .select("id")
    .ilike("address", address)
    .limit(1);
  if (error) fail(`Could not check visitor-wallet custody: ${error.message}`);
  if ((data ?? []).length > 0) {
    fail("Payer is a Crux-hosted visitor wallet and cannot be classified as independent.");
  }
}

function parseArgs(values: string[]) {
  const parsed: { payer?: string; proof?: string; attestIndependent: boolean } = {
    attestIndependent: false,
  };
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === "--attest-independent") {
      parsed.attestIndependent = true;
      continue;
    }
    if (!["--payer", "--proof"].includes(name)) {
      fail(`Unknown argument: ${name}`);
    }
    const value = values[index + 1]?.trim();
    if (!value) fail(`${name} requires a value.`);
    if (name === "--payer") parsed.payer = value;
    else parsed.proof = value;
    index += 1;
  }
  return parsed;
}

function normalizedUrl(value: string, label: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      fail(`${label} must use HTTPS.`);
    }
    url.pathname = url.pathname.replace(/\/$/, "");
    return url;
  } catch {
    fail(`${label} is not a valid URL.`);
  }
}

function fail(message: string): never {
  console.error(`BLOCK ${message}`);
  process.exit(1);
}
