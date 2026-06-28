import { createPublicClient, http } from "viem";
import {
  ARC_TESTNET_CHAIN_ID,
  classifySettlementReference,
  type SettlementKind,
  type SettlementStatus,
} from "./settlement.ts";

const ARC_TESTNET_RPC =
  process.env.ARC_TESTNET_RPC_URL ??
  process.env.NEXT_PUBLIC_ARC_RPC_URL ??
  "https://rpc.testnet.arc.network";

const publicClient = createPublicClient({
  transport: http(ARC_TESTNET_RPC),
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

export async function buildSettlementProofColumns(
  reference?: string | null,
): Promise<SettlementProofColumns> {
  const classified = classifySettlementReference(reference);
  const checkedAt = new Date().toISOString();

  const base: SettlementProofColumns = {
    settlement_reference: classified.settlementReference,
    settlement_kind: classified.settlementKind,
    settlement_status: classified.settlementStatus,
    arc_tx_hash: classified.arcTxHash,
    arc_chain_id:
      classified.settlementKind === "arc_tx_hash" ? ARC_TESTNET_CHAIN_ID : null,
    arc_block_number: null,
    arc_confirmed_at: null,
    settlement_checked_at: checkedAt,
  };

  if (!classified.arcTxHash) return base;

  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: classified.arcTxHash as `0x${string}`,
    });

    if (receipt.status !== "success") {
      return { ...base, settlement_status: "arc_failed" };
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
      ...base,
      settlement_status: "arc_confirmed",
      arc_block_number: receipt.blockNumber.toString(),
      arc_confirmed_at: confirmedAt ?? checkedAt,
    };
  } catch (err) {
    console.warn(
      "[settlement] Could not verify Arc tx hash:",
      (err as Error).message,
    );
    return base;
  }
}
