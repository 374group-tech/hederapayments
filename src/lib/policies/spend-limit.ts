import { env } from "../config";
import type { PolicyResult, PolicyContext } from "./types";

export class SpendLimitPolicy {
  readonly name = "SpendLimitPolicy";
  private dailyLimit: number;
  private perTxLimit: number;

  constructor(dailyLimit?: number, perTxLimit?: number) {
    this.dailyLimit = dailyLimit ?? env.DAILY_SPEND_LIMIT_HBAR;
    this.perTxLimit = perTxLimit ?? env.MAX_PER_TX_HBAR;
  }

  evaluate(ctx: PolicyContext): PolicyResult {
    // Check per-transaction cap
    if (ctx.currentTxHbar > this.perTxLimit) {
      return {
        allowed: false,
        policy: this.name,
        reason: `Per-transaction limit exceeded: ${ctx.currentTxHbar} HBAR > ${this.perTxLimit} HBAR max`,
      };
    }

    // Check daily cap
    const projected = ctx.dailySpentHbar + ctx.currentTxHbar;
    if (projected > this.dailyLimit) {
      return {
        allowed: false,
        policy: this.name,
        reason: `Daily spend limit would be exceeded: ${projected} HBAR > ${this.dailyLimit} HBAR (${ctx.dailySpentHbar} already spent)`,
      };
    }

    return { allowed: true, policy: this.name };
  }
}
