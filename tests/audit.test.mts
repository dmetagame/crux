import assert from "node:assert/strict";
import test from "node:test";
import type { GatewayClient } from "@circle-fin/x402-batching/client";
import { validateSourcedClaims } from "../lib/claims.ts";
import { PaymentAmountMismatchError, payWithinBudget } from "../lib/paid-purchase.ts";
import { normalizePaidResponse } from "../lib/paid-response.ts";
import { expectedPaymentAmountMismatch } from "../lib/payment-quote.ts";
import { classifySettlementReference, settlementStatusLabel } from "../lib/settlement.ts";
import {
  formatUsdcAtomic,
  parseAtomicAmount,
  usdcAtomicToNumber,
  usdcNumberToAtomic,
} from "../lib/usdc.ts";

test("USDC accounting preserves micro-unit amounts", () => {
  const atomic = usdcNumberToAtomic(0.012345);
  assert.equal(atomic.toString(), "12345");
  assert.equal(formatUsdcAtomic(atomic), "0.012345");
  assert.equal(usdcAtomicToNumber(atomic), 0.012345);
  assert.throws(() => parseAtomicAmount("0"), /must be positive/);
});

test("claim provenance rejects unpurchased sources", () => {
  const claims = [{ text: "Revenue grew.", sourceIds: ["financials", "rumor-wire"], evidence: "Audited revenue." }];
  assert.match(
    validateSourcedClaims(claims, new Set(["financials"])) ?? "",
    /without delivered evidence: rumor-wire/,
  );
  assert.equal(
    validateSourcedClaims(
      [{ text: "Revenue grew.", sourceIds: ["financials"], evidence: "Audited revenue." }],
      new Set(["financials"]),
    ),
    null,
  );
});

test("Gateway references are not mislabeled as Arc-confirmed settlements", () => {
  const gateway = classifySettlementReference("gateway-ref-123");
  assert.equal(gateway.settlementKind, "gateway_settlement_reference");
  assert.equal(gateway.settlementStatus, "gateway_reference_recorded");
  assert.equal(settlementStatusLabel(gateway.settlementStatus), "Gateway reference recorded");

  const hash = `0x${"a".repeat(64)}`;
  const arc = classifySettlementReference(hash);
  assert.equal(arc.settlementKind, "arc_tx_hash");
  assert.equal(arc.settlementStatus, "arc_unverified");
});

test("paid purchase refuses a quote above the remaining budget", async () => {
  let paid = false;
  const gateway = {
    supports: async () => ({ supported: true, requirements: { amount: "2000" } }),
    pay: async () => {
      paid = true;
      throw new Error("must not pay");
    },
  } as unknown as GatewayClient;

  await assert.rejects(() => payWithinBudget(gateway, "https://crux.test/source", BigInt(1000)), /only 1000 remains/);
  assert.equal(paid, false);
});

test("paid purchase rejects quote-to-settlement amount changes", async () => {
  let recordedAmount = BigInt(0);
  const gateway = {
    supports: async () => ({ supported: true, requirements: { amount: "1000" } }),
    pay: async () => ({ amount: BigInt(1001), data: {}, transaction: "gateway-ref" }),
  } as unknown as GatewayClient;

  await assert.rejects(
    () => payWithinBudget(gateway, "https://crux.test/source", BigInt(2000), {
      onSettled: (result) => {
        recordedAmount = result.amount;
      },
    }),
    (error) => {
      assert.equal(error instanceof PaymentAmountMismatchError, true);
      assert.equal((error as PaymentAmountMismatchError).result.amount, BigInt(1001));
      assert.equal((error as PaymentAmountMismatchError).result.transaction, "gateway-ref");
      return true;
    },
  );
  assert.equal(recordedAmount, BigInt(1001));
});

test("paid purchase binds payment execution to the inspected quote", async () => {
  let expectedHeader: string | undefined;
  let authorizationSigned = false;
  const gateway = {
    supports: async () => ({ supported: true, requirements: { amount: "1000" } }),
    pay: async (_url: string, options: { headers?: Record<string, string> }) => {
      expectedHeader = options.headers?.["X-Crux-Expected-Amount-Atomic"];
      const headers = new Headers(options.headers);
      if (expectedPaymentAmountMismatch(headers, "1001")) {
        throw new Error("seller rejected changed quote before signing");
      }
      authorizationSigned = true;
      throw new Error("unexpected signing path");
    },
  } as unknown as GatewayClient;

  await assert.rejects(
    () => payWithinBudget(gateway, "https://crux.test/source", BigInt(2000)),
    /rejected changed quote before signing/,
  );
  assert.equal(expectedHeader, "1000");
  assert.equal(authorizationSigned, false);
});

test("malformed paid payloads normalize without losing settlement accounting", () => {
  assert.deepEqual(normalizePaidResponse(null), {
    delivered: false,
    content: "",
    citationUrl: null,
  });
  assert.deepEqual(normalizePaidResponse({ delivered: true, content: 42, citationUrl: false }), {
    delivered: false,
    content: "",
    citationUrl: null,
  });
});
