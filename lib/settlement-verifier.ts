import { createPublicClient, getAddress, http } from "viem";
import {
  ARC_GATEWAY_DOMAIN,
  ARC_GATEWAY_WALLET,
  decodeArcGatewayBatchEvidence,
  type ArcGatewayBatchEvidence,
} from "./arc-batch-proof.ts";
import {
  fetchGatewayX402Transfer,
  type GatewayTransferExpectation,
  type GatewayTransferStatus,
  type GatewayX402Transfer,
} from "./gateway-transfer.ts";
import {
  ARC_TESTNET_CHAIN_ID,
  classifySettlementReference,
  isEvmTxHash,
  type SettlementKind,
  type SettlementStatus,
} from "./settlement.ts";

const ARC_TESTNET_RPC =
  process.env.ARC_TESTNET_RPC_URL ??
  process.env.NEXT_PUBLIC_ARC_RPC_URL ??
  "https://rpc.testnet.arc.network";

const publicClient = createPublicClient({
  transport: http(ARC_TESTNET_RPC, {
    retryCount: 0,
    timeout: 5_000,
  }),
});

export interface SettlementProofColumns {
  settlement_reference: string | null;
  settlement_kind: SettlementKind;
  settlement_status: SettlementStatus;
  arc_tx_hash: string | null;
  arc_chain_id: number | null;
  arc_block_number: string | null;
  arc_confirmed_at: string | null;
  settlement_checked_at: string | null;
}

export type SettlementProofResolution = {
  columns: SettlementProofColumns;
  gatewayTransferStatus: GatewayTransferStatus | null;
  gatewayTransfer: GatewayX402Transfer | null;
  arcBatchEvidence: ArcGatewayBatchEvidence | null;
};

type SettlementProofOptions = {
  resolveGatewayReference?: boolean;
  strictGatewayResolution?: boolean;
  expectedGatewayTransfer?: GatewayTransferExpectation;
  gatewayFetcher?: typeof fetch;
  knownArcTxHash?: string | null;
};

export async function buildSettlementProofColumns(
  reference?: string | null,
  options: SettlementProofOptions = {},
): Promise<SettlementProofColumns> {
  return (await resolveSettlementProof(reference, options)).columns;
}

export async function resolveSettlementProof(
  reference?: string | null,
  options: SettlementProofOptions = {},
): Promise<SettlementProofResolution> {
  const classified = classifySettlementReference(reference);
  const checkedAt = new Date().toISOString();
  const knownArcTxHash = options.knownArcTxHash?.trim();
  let arcTxHash = classified.arcTxHash ??
    (knownArcTxHash && isEvmTxHash(knownArcTxHash) ? knownArcTxHash : null);
  let gatewayTransferStatus: GatewayTransferStatus | null = null;
  let gatewayTransfer: GatewayX402Transfer | null = null;
  let resolvedFromGateway = false;

  if (
    options.resolveGatewayReference &&
    classified.settlementKind === "gateway_settlement_reference" &&
    classified.settlementReference
  ) {
    try {
      gatewayTransfer = await fetchGatewayX402Transfer(
        classified.settlementReference,
        options.expectedGatewayTransfer,
        options.gatewayFetcher,
      );
      if (!gatewayTransfer && options.strictGatewayResolution) {
        throw new Error("Circle Gateway transfer reference was not found.");
      }
      gatewayTransferStatus = gatewayTransfer?.status ?? null;
      if (gatewayTransfer?.txHash) {
        if (
          arcTxHash &&
          gatewayTransfer.txHash.toLowerCase() !== arcTxHash.toLowerCase()
        ) {
          throw new Error(
            "Circle Gateway batch transaction hash does not match the stored payment evidence.",
          );
        }
        arcTxHash = gatewayTransfer.txHash;
        resolvedFromGateway = true;
      }
    } catch (err) {
      if (options.strictGatewayResolution) throw err;
      console.warn(
        "[settlement] Could not resolve Circle Gateway transfer:",
        (err as Error).message,
      );
    }
  }

  const base: SettlementProofColumns = {
    settlement_reference: classified.settlementReference,
    settlement_kind: classified.settlementKind,
    settlement_status: arcTxHash ? "arc_unverified" : classified.settlementStatus,
    arc_tx_hash: arcTxHash,
    arc_chain_id: arcTxHash ? ARC_TESTNET_CHAIN_ID : null,
    arc_block_number: null,
    arc_confirmed_at: null,
    settlement_checked_at: checkedAt,
  };

  if (!arcTxHash) {
    return {
      columns: base,
      gatewayTransferStatus,
      gatewayTransfer,
      arcBatchEvidence: null,
    };
  }

  try {
    const [receipt, transaction] = await Promise.all([
      publicClient.getTransactionReceipt({
        hash: arcTxHash as `0x${string}`,
      }),
      publicClient.getTransaction({
        hash: arcTxHash as `0x${string}`,
      }),
    ]);

    if (receipt.status !== "success") {
      return {
        columns: { ...base, settlement_status: "arc_failed" },
        gatewayTransferStatus,
        gatewayTransfer,
        arcBatchEvidence: null,
      };
    }

    if (
      resolvedFromGateway &&
      (!receipt.to || getAddress(receipt.to) !== getAddress(ARC_GATEWAY_WALLET))
    ) {
      throw new Error(
        "Circle Gateway batch transaction targeted an unexpected contract.",
      );
    }

    let arcBatchEvidence: ArcGatewayBatchEvidence | null = null;
    if (resolvedFromGateway && gatewayTransfer) {
      arcBatchEvidence = decodeArcGatewayBatchEvidence({
        transactionInput: transaction.input,
        transactionTo: transaction.to,
        logs: receipt.logs,
        transfer: gatewayTransfer,
        gatewayWallet: ARC_GATEWAY_WALLET,
        expectedDomain: ARC_GATEWAY_DOMAIN,
      });
      if (arcBatchEvidence.netDeltaAtomic !== "0") {
        throw new Error("Circle Gateway batch deltas do not net to zero.");
      }
      if (!arcBatchEvidence.containsExpectedDeltas) {
        throw new Error(
          "Arc batch deltas do not cover the payer debit and seller credit reported by Circle.",
        );
      }
    }

    let confirmedAt: string | null = null;
    try {
      const block = await publicClient.getBlock({
        blockNumber: receipt.blockNumber,
      });
      confirmedAt = new Date(Number(block.timestamp) * 1000).toISOString();
    } catch (err) {
      console.warn(
        "[settlement] Could not fetch Arc block timestamp:",
        (err as Error).message,
      );
    }

    return {
      columns: {
        ...base,
        settlement_status: "arc_confirmed",
        arc_block_number: receipt.blockNumber.toString(),
        arc_confirmed_at: confirmedAt ?? checkedAt,
      },
      gatewayTransferStatus,
      gatewayTransfer,
      arcBatchEvidence,
    };
  } catch (err) {
    if (options.strictGatewayResolution && resolvedFromGateway) throw err;
    console.warn(
      "[settlement] Could not verify Arc tx hash:",
      (err as Error).message,
    );
    return {
      columns: base,
      gatewayTransferStatus,
      gatewayTransfer,
      arcBatchEvidence: null,
    };
  }
}
