export function visitorWalletReadiness(input: {
  walletUsdc: number;
  gatewayUsdc: number;
  nativeGasAtomic: bigint | null;
}) {
  const hasUsdc = input.walletUsdc > 0 || input.gatewayUsdc > 0;
  const gasReady = input.nativeGasAtomic === null ? null : input.nativeGasAtomic > BigInt(0);
  const requiresDeposit = input.gatewayUsdc <= 0 && input.walletUsdc > 0;
  const funded = input.gatewayUsdc > 0 || (input.walletUsdc > 0 && gasReady === true);

  return { funded, hasUsdc, gasReady, requiresDeposit };
}
