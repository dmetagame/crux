import { generateText, stepCountIs, tool } from "ai";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from "viem";
import { z } from "zod";
import {
  hasDirectGeminiFallback,
  modelsUsedForInference,
  runAgentInferenceWithFallback,
} from "../lib/agent-inference.ts";
import { gatewayRunReadiness } from "../lib/release-readiness.ts";
import {
  addressFromPrivateKey,
  requireHousePrivateKey,
  requireSellerPrivateKey,
  type HexAddress,
  type HexPrivateKey,
} from "../lib/wallet-keys.ts";
import { configuredDefaultAgentModel } from "../lib/agent-model-defaults.ts";

type Severity = "PASS" | "WARN" | "BLOCK";
const results: { severity: Severity; name: string; detail: string }[] = [];
const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (arg !== "--skip-ai") block("arguments", `Unknown argument: ${arg}`);
}

const baseUrl = normalizeBaseUrl(process.env.CRUX_BASE_URL ?? "https://crux-khaki.vercel.app");
const rpc = process.env.ARC_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const usdc = "0x3600000000000000000000000000000000000000" as const;
const publicClient = createPublicClient({ transport: http(rpc) });
const budgetUsdc = positiveNumber(process.env.CRUX_PREFLIGHT_HOUSE_BUDGET_USDC, 0.05);

await checkProduction();
await checkDatabasePrivacy();
await checkWallets();
await checkAi();
printResults();

if (results.some((result) => result.severity === "BLOCK")) {
  process.exit(1);
}

async function checkProduction() {
  try {
    const [versionResponse, statsResponse, challengeResponse] = await Promise.all([
      fetch(new URL("/api/version", baseUrl), { cache: "no-store", signal: AbortSignal.timeout(20_000) }),
      fetch(new URL("/api/stats", baseUrl), { cache: "no-store", signal: AbortSignal.timeout(20_000) }),
      fetch(new URL("/api/premium/quote", baseUrl), { cache: "no-store", signal: AbortSignal.timeout(20_000) }),
    ]);
    if (!versionResponse.ok) throw new Error(`/api/version returned HTTP ${versionResponse.status}`);
    const version = await versionResponse.json() as { gitSha?: unknown };
    if (typeof version.gitSha !== "string" || version.gitSha.length < 7) {
      throw new Error("deployment does not expose a valid git SHA");
    }
    pass("production", `serving git ${version.gitSha.slice(0, 12)}`);

    if (!statsResponse.ok) throw new Error(`/api/stats returned HTTP ${statsResponse.status}`);
    const stats = await statsResponse.json() as Record<string, unknown>;
    const payments = finiteNumber(stats.totalPayments);
    const completed = finiteNumber(stats.completedTasks);
    if (payments === null || completed === null) throw new Error("production stats are incomplete");
    pass("public evidence", `${payments} payments and ${completed} completed tasks are queryable`);
    const externalPayers = finiteNumber(stats.independentExternalPayers) ?? 0;
    if (externalPayers > 0) pass("external payer proof", `${externalPayers} independently attributed payer(s)`);
    else warn("external payer proof", "no independently attributed external payer yet; core product remains available");

    if (challengeResponse.status !== 402 || !challengeResponse.headers.get("payment-required")) {
      throw new Error(`x402 challenge returned HTTP ${challengeResponse.status} without PAYMENT-REQUIRED`);
    }
    pass("x402 seller", "production quote endpoint advertises a payment challenge");
  } catch (error) {
    block("production", (error as Error).message);
  }
}

async function checkDatabasePrivacy() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !publishableKey || !serviceRoleKey) {
    block(
      "receipt privacy migration",
      "Supabase URL, publishable key, and service-role key are required to verify production RLS.",
    );
    return;
  }

  try {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createSupabaseClient(url, serviceRoleKey, options);
    const anonymous = createSupabaseClient(url, publishableKey, options);
    const { data: receipt, error: adminError } = await admin
      .from("run_receipts")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (adminError) throw new Error(`service-role receipt probe failed: ${adminError.message}`);
    if (!receipt?.id) {
      warn("receipt privacy migration", "no production receipt exists to exercise anonymous RLS");
      return;
    }

    const { data: publicRows, error: publicError } = await anonymous
      .from("run_receipts")
      .select("id")
      .eq("id", receipt.id);
    if (publicError) throw new Error(`anonymous receipt probe failed: ${publicError.message}`);
    if ((publicRows ?? []).length > 0) {
      block(
        "receipt privacy migration",
        "raw run_receipts are still anonymously readable; apply 20260310000011_restrict_raw_run_receipts.sql",
      );
      return;
    }
    pass("receipt privacy migration", "raw run_receipts are restricted to the sanitized app/API projection");
  } catch (error) {
    block("receipt privacy migration", (error as Error).message);
  }
}

async function checkWallets() {
  let houseKey: HexPrivateKey;
  try {
    houseKey = requireHousePrivateKey();
  } catch (error) {
    block("house wallet configuration", (error as Error).message);
    return;
  }

  try {
    const house = await balances(houseKey);
    const readiness = gatewayRunReadiness({
      budgetUsdc,
      walletUsdcAtomic: house.walletUsdcAtomic,
      gatewayAvailableAtomic: house.gatewayAvailableAtomic,
      nativeGasAtomic: house.nativeGasAtomic,
    });
    if (readiness.ready) {
      pass(
        "house wallet",
        readiness.needsDeposit
          ? `ready for automatic deposit and a ${budgetUsdc} USDC run`
          : `${formatAtomic(house.gatewayAvailableAtomic)} Gateway USDC covers a ${budgetUsdc} USDC run`,
      );
    } else {
      block("house wallet", readiness.reasons.join("; "));
    }

  } catch (error) {
    block("house Arc/Gateway balances", (error as Error).message);
  }

  try {
    const sellerKey = requireSellerPrivateKey();
    const seller = await balances(sellerKey);
    if (seller.gatewayTotalAtomic > BigInt(0)) {
      pass("seller balance", `${formatAtomic(seller.gatewayTotalAtomic)} USDC recorded in Circle Gateway`);
    } else {
      warn("seller balance", "Gateway balance is zero; receiving new x402 payments still works");
    }
    if (seller.nativeGasAtomic > BigInt(0)) {
      pass("withdrawal gas", `${trim(formatEther(seller.nativeGasAtomic))} native USDC on Arc Testnet`);
    } else {
      warn("withdrawal gas", `seller ${seller.address} needs faucet gas only if withdrawal will be demonstrated`);
    }
  } catch (error) {
    warn("seller withdrawal readiness", `${(error as Error).message} Receiving x402 payments remains available.`);
  }
}

async function checkAi() {
  if (args.has("--skip-ai")) {
    warn("AI Gateway", "capacity probe explicitly skipped");
    return;
  }
  const hasGatewayCredential = Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim(),
  );
  if (!hasGatewayCredential && !hasDirectGeminiFallback()) {
    block("AI inference", "no AI Gateway credential or direct Gemini fallback key is available for the release probe");
    return;
  }

  const model = process.env.CRUX_PREFLIGHT_MODEL?.trim() || configuredDefaultAgentModel();
  const timeoutMs = positiveInteger(process.env.CRUX_PREFLIGHT_AI_TIMEOUT_MS, 50_000);
  let toolCalled = false;
  try {
    const inference = await runAgentInferenceWithFallback({
      primaryModel: model,
      purchaseAttempted: () => false,
      resetBeforeFallback: () => {
        toolCalled = false;
      },
      run: (attempt) => generateText({
        model: attempt.model,
        prompt: "Call release_ready exactly once, then reply READY.",
        toolChoice: { type: "tool", toolName: "release_ready" },
        tools: {
          release_ready: tool({
            description: "Confirms that the Crux agent tool loop is available.",
            inputSchema: z.object({}),
            execute: async () => {
              toolCalled = true;
              return { ready: true };
            },
          }),
        },
        stopWhen: [() => toolCalled, stepCountIs(2)],
        maxOutputTokens: 64,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
        providerOptions: attempt.providerOptions,
      }),
    });
    const result = inference.value;
    if (!toolCalled) throw new Error("model did not execute the required tool call");
    const models = modelsUsedForInference(result.steps, inference.attempt);
    pass(
      "AI inference",
      `configured ${inference.attempt.route} route completed a ${result.steps.length}-step tool loop (${models.join(", ")})`,
    );
  } catch (error) {
    block("AI inference", `capacity probe failed: ${safeError(error)}`);
  }
}

async function balances(privateKey: HexPrivateKey) {
  const gateway = new GatewayClient({ chain: "arcTestnet", privateKey });
  const address = addressFromPrivateKey(privateKey);
  const [nativeGasAtomic, walletUsdcAtomic, gatewayBalances] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    gateway.getBalances(),
  ]);
  return {
    address: address as HexAddress,
    nativeGasAtomic,
    walletUsdcAtomic: walletUsdcAtomic as bigint,
    gatewayAvailableAtomic: gatewayBalances.gateway.available,
    gatewayTotalAtomic: gatewayBalances.gateway.total,
  };
}

function printResults() {
  console.log(`Crux release readiness for ${baseUrl.origin}`);
  console.log("");
  for (const result of results) {
    console.log(`${result.severity.padEnd(5)} ${result.name}: ${result.detail}`);
  }
  const blocks = results.filter((result) => result.severity === "BLOCK").length;
  const warnings = results.filter((result) => result.severity === "WARN").length;
  console.log("");
  console.log(blocks > 0
    ? `NOT READY: ${blocks} blocker(s), ${warnings} warning(s).`
    : `READY: no core blockers, ${warnings} optional warning(s).`);
}

function pass(name: string, detail: string) {
  results.push({ severity: "PASS", name, detail });
}

function warn(name: string, detail: string) {
  results.push({ severity: "WARN", name, detail });
}

function block(name: string, detail: string) {
  results.push({ severity: "BLOCK", name, detail });
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("CRUX_BASE_URL must use HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted-google-api-key]")
    .replace(/\bAQ\.[0-9A-Za-z_-]{20,}\b/g, "[redacted-google-api-key]")
    .replace(/([?&](?:key|api_key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(?:sk|vck|sb_secret)_[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 300);
}

function formatAtomic(value: bigint) {
  return trim(formatUnits(value, 6));
}

function trim(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}
