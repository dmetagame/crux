/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  CHAIN_CONFIGS,
  GatewayClient,
  type SupportedChainName,
  GATEWAY_DOMAINS,
} from "@circle-fin/x402-batching/client";
import { isAddress, pad, zeroAddress } from "viem";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADMIN_SESSION_COOKIE,
  isAdminSession,
  isSameOriginAdminMutation,
} from "@/lib/admin-auth";
import {
  parseGatewayFeeEstimate,
  parseWithdrawalUsdc,
} from "@/lib/gateway-withdrawal";
import { formatUsdcAtomic } from "@/lib/usdc";
import { requireSellerPrivateKey } from "@/lib/wallet-keys";

const SUPPORTED_CHAIN_LABELS: Record<string, string> = {
  arcTestnet: "Arc Testnet",
  baseSepolia: "Base Sepolia",
  sepolia: "Ethereum Sepolia",
  arbitrumSepolia: "Arbitrum Sepolia",
  optimismSepolia: "Optimism Sepolia",
  avalancheFuji: "Avalanche Fuji",
  polygonAmoy: "Polygon Amoy",
};
const ALLOWED_DESTINATION_CHAINS = new Set(Object.keys(SUPPORTED_CHAIN_LABELS));
const GATEWAY_ESTIMATE_API = "https://gateway-api-testnet.circle.com/v1/estimate";

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return supabaseClient;
}

export async function POST(req: NextRequest) {
  if (!(await isAdminSession(req.cookies.get(ADMIN_SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSameOriginAdminMutation(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let privateKey: `0x${string}`;
  try {
    privateKey = requireSellerPrivateKey();
  } catch (err) {
    console.error("[gateway] seller private-key configuration error:", (err as Error).message);
    return NextResponse.json(
      { error: "Seller withdrawal wallet is not configured" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const amount = typeof input.amount === "string" ? input.amount.trim() : "";
  const destinationChain =
    typeof input.destinationChain === "string" ? input.destinationChain.trim() : "";
  const destinationAddress =
    typeof input.destinationAddress === "string"
      ? input.destinationAddress.trim() || undefined
      : input.destinationAddress == null
        ? undefined
        : null;

  if (!amount || !destinationChain) {
    return NextResponse.json(
      { error: "amount and destinationChain are required" },
      { status: 400 },
    );
  }
  const amountAtomic = parseWithdrawalUsdc(amount);
  if (amountAtomic == null || amountAtomic <= BigInt(0)) {
    return NextResponse.json(
      { error: "amount must be a positive USDC value with at most 6 decimals" },
      { status: 400 },
    );
  }
  if (destinationAddress === null || (destinationAddress && !isAddress(destinationAddress))) {
    return NextResponse.json(
      { error: "destinationAddress must be a valid EVM address" },
      { status: 400 },
    );
  }

  if (
    !ALLOWED_DESTINATION_CHAINS.has(destinationChain) ||
    !Object.prototype.hasOwnProperty.call(GATEWAY_DOMAINS, destinationChain)
  ) {
    return NextResponse.json(
      { error: `Unsupported chain: ${destinationChain}` },
      { status: 400 },
    );
  }

  const gateway = new GatewayClient({
    chain: "arcTestnet",
    privateKey,
  });
  const normalizedAmount = formatUsdcAtomic(amountAtomic);
  const recipient = (destinationAddress ?? gateway.address) as `0x${string}`;

  const isCrossChain = destinationChain !== "arcTestnet";

  let withdrawalFees: Awaited<ReturnType<typeof estimateWithdrawalFees>>;
  try {
    withdrawalFees = await estimateWithdrawalFees({
      gateway,
      destinationChain: destinationChain as SupportedChainName,
      recipient,
      amountAtomic,
    });
    const balances = await gateway.getBalances();
    const requiredAtomic = amountAtomic + withdrawalFees.maxFeeAtomic;
    if (balances.gateway.available < requiredAtomic) {
      return NextResponse.json(
        {
          error: `Insufficient gateway balance: ${balances.gateway.formattedAvailable} USDC available. Withdrawing ${normalizedAmount} USDC requires up to ${formatUsdcAtomic(withdrawalFees.maxFeeAtomic)} USDC of fee headroom.`,
        },
        { status: 400 },
      );
    }
  } catch (balanceError) {
    console.error("Failed to estimate fees or check balances before withdraw:", balanceError);
    return NextResponse.json(
      { error: "Could not estimate Gateway fees or verify the seller balance. Try again shortly." },
      { status: 503 },
    );
  }

  // Pre-check native gas on the destination chain, including same-chain Arc withdrawals.
  try {
    const destGateway = new GatewayClient({
      chain: destinationChain as SupportedChainName,
      privateKey,
    });
    const destinationGas = await destGateway.publicClient.getBalance({
      address: destGateway.address,
    });
    if (destinationGas === BigInt(0)) {
      const chainLabel =
        SUPPORTED_CHAIN_LABELS[destinationChain] ?? destinationChain;
      return NextResponse.json(
        {
          error: `Seller wallet (${destGateway.address}) has no native gas token on ${chainLabel}. Fund it on ${chainLabel} before retrying.`,
        },
        { status: 400 },
      );
    }
  } catch (destBalanceError) {
    console.error(
      "Failed to check destination chain gas balance:",
      destBalanceError,
    );
    return NextResponse.json(
      { error: "Could not verify destination-chain gas. Try again shortly." },
      { status: 503 },
    );
  }

  const supabase = getSupabase();

  // Insert a pending withdrawal record
  const { data: withdrawal, error: insertError } = await supabase
    .from("withdrawals")
    .insert({
      amount_usdc: normalizedAmount,
      destination_chain: destinationChain,
      destination_address: recipient,
      status: "submitted",
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to record withdrawal: " + insertError.message },
      { status: 500 },
    );
  }

  try {
    const result = await gateway.withdraw(normalizedAmount, {
      chain: destinationChain as SupportedChainName,
      recipient,
      maxFee: formatUsdcAtomic(withdrawalFees.maxFeeAtomic),
    });

    // Update the withdrawal record with the transaction hash
    await supabase
      .from("withdrawals")
      .update({ status: "confirmed", tx_hash: result.mintTxHash })
      .eq("id", withdrawal.id);

    return NextResponse.json({
      id: withdrawal.id,
      txHash: result.mintTxHash,
      amount: result.formattedAmount,
      sourceChain: result.sourceChain,
      destinationChain: result.destinationChain,
      recipient: result.recipient,
      estimatedFee: formatUsdcAtomic(withdrawalFees.estimatedFeeAtomic),
      maxFee: formatUsdcAtomic(withdrawalFees.maxFeeAtomic),
      status: "confirmed",
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);

    // Mark withdrawal as failed
    await supabase
      .from("withdrawals")
      .update({ status: "failed" })
      .eq("id", withdrawal.id);

    // Translate common on-chain errors into user-friendly messages
    const chainLabel =
      SUPPORTED_CHAIN_LABELS[destinationChain] ?? destinationChain;
    let message = raw;
    if (
      raw.includes("insufficient funds for gas") ||
      raw.includes("exceeds the balance of the account") ||
      raw.includes("gas required exceeds allowance")
    ) {
      message = isCrossChain
        ? `Seller wallet (${gateway.address}) has insufficient native gas on ${chainLabel} for the transfer. Fund it on ${chainLabel} and retry.`
        : `Seller wallet has insufficient native gas on Arc Testnet. Fund ${gateway.address} at faucet.circle.com and retry.`;
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function estimateWithdrawalFees(input: {
  gateway: GatewayClient;
  destinationChain: SupportedChainName;
  recipient: `0x${string}`;
  amountAtomic: bigint;
}) {
  const destination = CHAIN_CONFIGS[input.destinationChain];
  const response = await fetch(GATEWAY_ESTIMATE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify([
      {
        spec: {
          version: 1,
          sourceDomain: input.gateway.chainConfig.domain,
          destinationDomain: destination.domain,
          sourceContract: pad(input.gateway.chainConfig.gatewayWallet.toLowerCase() as `0x${string}`, { size: 32 }),
          destinationContract: pad(destination.gatewayMinter.toLowerCase() as `0x${string}`, { size: 32 }),
          sourceToken: pad(input.gateway.chainConfig.usdc.toLowerCase() as `0x${string}`, { size: 32 }),
          destinationToken: pad(destination.usdc.toLowerCase() as `0x${string}`, { size: 32 }),
          sourceDepositor: pad(input.gateway.address.toLowerCase() as `0x${string}`, { size: 32 }),
          destinationRecipient: pad(input.recipient.toLowerCase() as `0x${string}`, { size: 32 }),
          sourceSigner: pad(input.gateway.address.toLowerCase() as `0x${string}`, { size: 32 }),
          destinationCaller: pad(zeroAddress, { size: 32 }),
          value: input.amountAtomic.toString(),
          salt: `0x${randomBytes(32).toString("hex")}`,
          hookData: "0x",
        },
      },
    ]),
  });
  if (!response.ok) {
    throw new Error(`Gateway fee estimate failed with HTTP ${response.status}`);
  }

  return parseGatewayFeeEstimate(await response.json());
}
