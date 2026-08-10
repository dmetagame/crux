const ARC_EXPLORER_BASE = "https://testnet.arcscan.app";

export const ARC_TESTNET_CHAIN_ID = 5042002;

export type SettlementKind =
  | "arc_tx_hash"
  | "gateway_settlement_reference"
  | "none";

export type SettlementStatus =
  | "arc_confirmed"
  | "arc_failed"
  | "arc_unverified"
  | "gateway_reference_recorded"
  | "recorded";

export function isEvmTxHash(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function settlementExplorerUrl(value: string) {
  return isEvmTxHash(value) ? `${ARC_EXPLORER_BASE}/tx/${value}` : null;
}

export function classifySettlementReference(value?: string | null): {
  settlementReference: string | null;
  settlementKind: SettlementKind;
  settlementStatus: SettlementStatus;
  arcTxHash: string | null;
} {
  const settlementReference = value?.trim() || null;

  if (!settlementReference) {
    return {
      settlementReference: null,
      settlementKind: "none",
      settlementStatus: "recorded",
      arcTxHash: null,
    };
  }

  if (isEvmTxHash(settlementReference)) {
    return {
      settlementReference,
      settlementKind: "arc_tx_hash",
      settlementStatus: "arc_unverified",
      arcTxHash: settlementReference,
    };
  }

  return {
    settlementReference,
    settlementKind: "gateway_settlement_reference",
    settlementStatus: "gateway_reference_recorded",
    arcTxHash: null,
  };
}

export function shortSettlementId(value: string, chars = 8) {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

export function settlementLabel(value: string, chars = 8) {
  return isEvmTxHash(value)
    ? `Arc tx ${shortSettlementId(value, chars)}`
    : `Gateway ref ${shortSettlementId(value, chars)}`;
}

export function settlementStatusLabel(status?: string | null) {
  switch (status) {
    case "arc_confirmed":
      return "Arc confirmed";
    case "arc_failed":
      return "Arc failed";
    case "arc_unverified":
      return "Arc unverified";
    case "gateway_reference_recorded":
      return "Gateway reference recorded";
    default:
      return "Recorded";
  }
}
