export type GatewayRunReadiness = {
  ready: boolean;
  needsDeposit: boolean;
  requiredGatewayAtomic: bigint;
  depositAtomic: bigint;
  reasons: string[];
};

export type GatewayFundingPlan = {
  requiredGatewayAtomic: bigint;
  depositAtomic: bigint;
  depositUsdc: string;
};

export function gatewayFundingPlan(budgetUsdc: number): GatewayFundingPlan {
  if (!Number.isFinite(budgetUsdc) || budgetUsdc <= 0) {
    throw new Error("Gateway funding budget must be a positive number.");
  }

  const requiredGatewayAtomic = BigInt(Math.ceil(budgetUsdc * 1.2 * 1_000_000));
  const depositUsdc = Math.max(1, budgetUsdc * 2).toFixed(6);
  const depositAtomic = BigInt(Math.round(Number(depositUsdc) * 1_000_000));

  return { requiredGatewayAtomic, depositAtomic, depositUsdc };
}

export function gatewayRunReadiness(input: {
  budgetUsdc: number;
  walletUsdcAtomic: bigint;
  gatewayAvailableAtomic: bigint;
  nativeGasAtomic: bigint;
}): GatewayRunReadiness {
  const { requiredGatewayAtomic, depositAtomic } = gatewayFundingPlan(input.budgetUsdc);

  if (input.gatewayAvailableAtomic >= requiredGatewayAtomic) {
    return {
      ready: true,
      needsDeposit: false,
      requiredGatewayAtomic,
      depositAtomic,
      reasons: [],
    };
  }

  const reasons: string[] = [];
  if (input.walletUsdcAtomic < depositAtomic) {
    reasons.push(`wallet needs ${formatAtomic(depositAtomic)} USDC for the automatic Gateway deposit`);
  }
  if (input.nativeGasAtomic <= BigInt(0)) {
    reasons.push("wallet has no Arc native gas for the automatic Gateway deposit");
  }

  return {
    ready: reasons.length === 0,
    needsDeposit: true,
    requiredGatewayAtomic,
    depositAtomic,
    reasons,
  };
}

function formatAtomic(value: bigint) {
  const whole = value / BigInt(1_000_000);
  const fraction = (value % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
