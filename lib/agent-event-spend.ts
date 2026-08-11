import type { AgentEvent } from "./agent.ts";
import { usdcAtomicToNumber } from "./usdc.ts";

export function spendAfterAgentEvent(spentUsdc: number, event: AgentEvent) {
  if (event.kind !== "purchase") return spentUsdc;

  try {
    const next = spentUsdc + usdcAtomicToNumber(BigInt(event.amountAtomic));
    return Math.round(next * 1_000_000) / 1_000_000;
  } catch {
    return spentUsdc;
  }
}
