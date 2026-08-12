import { readFileSync, statSync } from "node:fs";
import { getAddress, isAddress } from "viem";
import { verifyExternalPaymentProof } from "../lib/external-payment-proof.ts";

type VisitorCredentials = {
  walletId: string;
  address: `0x${string}`;
  walletToken: string;
};

const args = parseArgs(process.argv.slice(2));
const credentialsPath = args.credentials ?? process.env.CRUX_VISITOR_PROOF_FILE?.trim();
if (!credentialsPath) {
  fail("Pass --credentials /path/to/gitignored-wallet.json or set CRUX_VISITOR_PROOF_FILE.");
}
const credentials = readCredentials(credentialsPath);
const baseUrl = normalizeBaseUrl(process.env.CRUX_BASE_URL ?? "https://crux-khaki.vercel.app");
let statusBefore: Awaited<ReturnType<typeof loadWalletStatus>>;
try {
  statusBefore = await loadWalletStatus(baseUrl, credentials);
} catch (error) {
  fail((error as Error).message);
}

if (getAddress(statusBefore.address) !== getAddress(credentials.address)) {
  fail("Wallet status returned a different address than the credential file.");
}
if (!statusBefore.funded) {
  const reason = statusBefore.hasUsdc && statusBefore.gasReady === false
    ? "wallet has USDC but still needs Arc native gas for its first Gateway deposit"
    : "wallet needs Arc testnet USDC and native gas from faucet.circle.com";
  fail(`Visitor wallet is not run-ready: ${reason}.`);
}

console.log(`PASS visitor wallet ${credentials.address} is authenticated and run-ready`);
console.log(`PASS wallet ${statusBefore.walletUsdc} USDC; Gateway ${statusBefore.gatewayUsdc} USDC`);

if (!args.execute) {
  console.log("DRY RUN no agent call or payment was made; pass --execute to run the paid journey.");
  process.exit(0);
}

const subject = args.subject ?? "Coinbase";
const budget = args.budget ?? 0.03;
if (!Number.isFinite(budget) || budget <= 0 || budget > 0.03) {
  fail("Visitor verification budget must be greater than 0 and no more than 0.03 USDC.");
}

console.log(`EXECUTE starting one capped visitor-funded run for ${JSON.stringify(subject)}`);
let response: Response;
try {
  response = await fetch(new URL("/api/agent/real", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Crux-Wallet-Token": credentials.walletToken,
      "Idempotency-Key": `visitor-verification-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      subject,
      budget,
      walletId: credentials.walletId,
    }),
    signal: AbortSignal.timeout(90_000),
  });
} catch (error) {
  fail(`Visitor run request failed: ${(error as Error).message}`);
}

if (!response.ok || !response.body) {
  fail(`Visitor run returned HTTP ${response.status}.`);
}

let terminal: Record<string, unknown> | null = null;
for (const event of await readNdjson(response)) {
  if (event.type === "done" || event.type === "error") terminal = event;
}
if (!terminal) fail("Visitor run ended without a terminal NDJSON event.");

const receiptId = typeof terminal.receiptId === "string" ? terminal.receiptId : null;
if (!receiptId) fail(`Visitor run ${terminal.type === "error" ? "failed" : "completed"} without a durable receipt.`);

const receipt = await loadReceipt(baseUrl, receiptId);
const evidence = Array.isArray(receipt.paymentEvidence) ? receipt.paymentEvidence : [];
for (const payment of evidence) {
  const record = payment && typeof payment === "object" && !Array.isArray(payment)
    ? payment as Record<string, unknown>
    : null;
  verifyExternalPaymentProof({
    body: { payment },
    expectedPayer: credentials.address,
    expectedReference: typeof record?.settlementReference === "string"
      ? record.settlementReference
      : null,
  });
}

if (terminal.type === "error") {
  if (evidence.length > 0) {
    console.error(`RETAINED ${evidence.length} settled payment proof(s) in ${receipt.receiptUrl}`);
  }
  fail(typeof terminal.message === "string" ? terminal.message : "Visitor run failed.");
}
if (receipt.status !== "completed" || receipt.payerKind !== "visitor-wallet") {
  fail("Receipt does not identify a completed visitor-wallet run.");
}
if (evidence.length === 0) {
  fail("Completed visitor run has no payment evidence.");
}
const spent = Number(receipt.spentUsdc);
if (!Number.isFinite(spent) || spent <= 0 || spent > budget) {
  fail("Receipt spend is missing or exceeds the requested visitor budget.");
}

console.log(`PASS visitor run completed with ${evidence.length} verified Circle settlement proof(s)`);
console.log(`PASS ${spent} USDC spent within the ${budget} USDC cap`);
console.log(`PASS receipt ${receipt.receiptUrl}`);

function readCredentials(path: string): VisitorCredentials {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch (error) {
    fail(`Could not read credential file metadata: ${(error as Error).message}`);
  }
  if ((mode & 0o077) !== 0) {
    fail("Credential file must not be readable or writable by group/other users (use chmod 600).");
  }

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Could not parse credential file: ${(error as Error).message}`);
  }
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const walletId = typeof record?.walletId === "string" ? record.walletId.trim() : "";
  const address = typeof record?.address === "string" ? record.address.trim() : "";
  const walletToken = typeof record?.walletToken === "string" ? record.walletToken.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(walletId)) {
    fail("Credential file has an invalid walletId.");
  }
  if (!isAddress(address)) fail("Credential file has an invalid address.");
  if (walletToken.length < 24 || walletToken.length > 512) {
    fail("Credential file has an invalid walletToken.");
  }
  return { walletId, address: getAddress(address), walletToken };
}

async function loadWalletStatus(baseUrl: URL, credentials: VisitorCredentials) {
  const url = new URL("/api/wallet/status", baseUrl);
  url.searchParams.set("walletId", credentials.walletId);
  const response = await fetch(url, {
    headers: { "X-Crux-Wallet-Token": credentials.walletToken },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`Wallet status returned HTTP ${response.status}: ${String(body.error ?? "unknown error")}`);
  }
  return body as {
    address: string;
    funded: boolean;
    hasUsdc: boolean;
    gasReady: boolean | null;
    walletUsdc: number;
    gatewayUsdc: number;
  };
}

async function loadReceipt(baseUrl: URL, receiptId: string) {
  const url = new URL(`/api/runs/${encodeURIComponent(receiptId)}`, baseUrl);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (response.ok) return response.json() as Promise<Record<string, any>>;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Could not load the visitor run receipt after five attempts.");
}

async function readNdjson(response: Response) {
  const text = await response.text();
  return text.split("\n").filter((line) => line.trim()).map((line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      fail("Visitor run returned malformed NDJSON.");
    }
  });
}

function parseArgs(values: string[]) {
  const parsed: {
    credentials?: string;
    execute: boolean;
    subject?: string;
    budget?: number;
  } = { execute: false };
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === "--execute") {
      parsed.execute = true;
      continue;
    }
    if (!["--credentials", "--subject", "--budget"].includes(name)) {
      fail(`Unknown argument: ${name}`);
    }
    const value = values[index + 1]?.trim();
    if (!value) fail(`${name} requires a value.`);
    if (name === "--credentials") parsed.credentials = value;
    else if (name === "--subject") parsed.subject = value.slice(0, 240);
    else parsed.budget = Number(value);
    index += 1;
  }
  return parsed;
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    fail("CRUX_BASE_URL must use HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function fail(message: string): never {
  console.error(`BLOCK ${message}`);
  process.exit(1);
}
