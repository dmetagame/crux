const ARC_EXPLORER_BASE = "https://testnet.arcscan.app";

export function isEvmTxHash(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function settlementExplorerUrl(value: string) {
  return isEvmTxHash(value) ? `${ARC_EXPLORER_BASE}/tx/${value}` : null;
}

export function shortSettlementId(value: string, chars = 8) {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}
