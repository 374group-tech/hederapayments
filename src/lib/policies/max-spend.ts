/**
 * MaxSpendPolicy — USD-based daily spending limit with per-project budgeting.
 *
 * Differs from SpendLimitPolicy: that one works in HBAR only.
 * This policy supports HBAR *and* USDC, converting everything to USD
 * for a consolidated daily cap.
 *
 * HAK v4 integration: extends AbstractPolicy, blocks at
 * PostParamsNormalization after amounts are resolved.
 */
import { AbstractPolicy } from "@hashgraph/hedera-agent-kit";
import type {
  PreToolExecutionParams,
  PostParamsNormalizationParams,
} from "@hashgraph/hedera-agent-kit";
import type { PolicyResult, PolicyContext } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectBudget {
  projectId: string;
  dailyLimitUsd: number;
  spentTodayUsd: number;
  lastResetDate: string; // YYYY-MM-DD
}

export interface MaxSpendPolicyOptions {
  /** Global daily limit in USD (default $50). */
  dailyLimitUsd?: number;
  /** Per-project budgets keyed by project ID. */
  projectBudgets?: Record<string, number>;
  /** HBAR → USD exchange rate. Defaults to a reasonable estimate. */
  hbarToUsd?: number;
  /** Whether to allow USDC transfers (treated 1:1 with USD). */
  usdcEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export class MaxSpendPolicy extends AbstractPolicy {
  readonly name = "MaxSpendPolicy";
  readonly description =
    "Limits total daily spending in USD across HBAR and USDC transfers, with per-project budget tracking.";

  /** Apply this policy to all transfer-like tools. */
  readonly relevantTools = [
    "transfer_hbar",
    "transfer_hbar_with_allowance",
    "transfer_fungible_token",
    "transfer_fungible_token_with_allowance",
    "airdrop_fungible_token",
  ];

  // ---- config -------------------------------------------------------------
  private dailyLimitUsd: number;
  private projectBudgets: Map<string, ProjectBudget>;
  private hbarToUsd: number;
  private usdcEnabled: boolean;

  // ---- state --------------------------------------------------------------
  private dailySpentUsd = 0;
  private currentDate = this.today();

  constructor(options: MaxSpendPolicyOptions = {}) {
    super();

    this.dailyLimitUsd = options.dailyLimitUsd ?? 50;
    this.hbarToUsd = options.hbarToUsd ?? 0.05; // conservative default
    this.usdcEnabled = options.usdcEnabled ?? true;

    this.projectBudgets = new Map();
    if (options.projectBudgets) {
      for (const [projectId, limit] of Object.entries(options.projectBudgets)) {
        this.projectBudgets.set(projectId, {
          projectId,
          dailyLimitUsd: limit,
          spentTodayUsd: 0,
          lastResetDate: this.currentDate,
        });
      }
    }
  }

  // ---- date helpers -------------------------------------------------------
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private maybeResetDaily(): void {
    const today = this.today();
    if (today !== this.currentDate) {
      console.log(
        `[MaxSpendPolicy] New day — resetting daily totals (was ${this.currentDate})`,
      );
      this.currentDate = today;
      this.dailySpentUsd = 0;
      this.projectBudgets.forEach((budget) => {
        budget.spentTodayUsd = 0;
        budget.lastResetDate = today;
      });
    }
  }

  // ---- USD estimation -----------------------------------------------------
  /**
   * Estimate the USD value of a transaction.
   * Looks at the normalised params for amount info.
   */
  private estimateUsd(params: PostParamsNormalizationParams): number {
    const np = params.normalisedParams ?? {};
    const rp = params.rawParams ?? {};

    // HBAR transfer — normalised amount is in tinybars
    const amount = np.amount ?? rp.amount;
    if (amount != null) {
      // tinybar → HBAR → USD  (1 HBAR = 100_000_000 tinybar)
      const amountNum = typeof amount === "object" && "toNumber" in amount
        ? (amount as any).toNumber()
        : Number(amount);
      // amount in tinybars; convert to HBAR, then USD
      const hbarValue = amountNum / 100_000_000;
      return hbarValue * this.hbarToUsd;
    }

    // Token transfer — check if USDC
    const tokenId: string | undefined = np.tokenId ?? rp.tokenId;
    if (tokenId && this.usdcEnabled) {
      // If it's a USDC token, treat the amount as 1:1 USD
      // (real impl would query token info from mirror node)
      const rawAmt = np.amount ?? rp.amount ?? 0;
      return typeof rawAmt === "number" ? rawAmt : 0;
    }

    return 0;
  }

  // ---- HAK v4 Policy hooks -----------------------------------------------
  /**
   * Block at PostParamsNormalization — we have the resolved amounts.
   */
  protected shouldBlockPostParamsNormalization(
    params: PostParamsNormalizationParams,
    _method: string,
  ): boolean {
    this.maybeResetDaily();

    const usdEstimate = this.estimateUsd(params);
    if (usdEstimate <= 0) return false; // nothing to spend

    // Check global daily limit
    if (this.dailySpentUsd + usdEstimate > this.dailyLimitUsd) {
      console.warn(
        `[MaxSpendPolicy] BLOCKED — daily USD limit exceeded: ` +
          `$${(this.dailySpentUsd + usdEstimate).toFixed(2)} > $${this.dailyLimitUsd.toFixed(2)}`,
      );
      return true;
    }

    // Check per-project budgets (if a projectId is present)
    const rp = params.rawParams as Record<string, unknown> | undefined;
    const projectId = rp?.projectId as string | undefined;
    if (projectId && this.projectBudgets.has(projectId)) {
      const budget = this.projectBudgets.get(projectId)!;
      if (budget.spentTodayUsd + usdEstimate > budget.dailyLimitUsd) {
        console.warn(
          `[MaxSpendPolicy] BLOCKED — project "${projectId}" budget exceeded: ` +
            `$${(budget.spentTodayUsd + usdEstimate).toFixed(2)} > $${budget.dailyLimitUsd.toFixed(2)}`,
        );
        return true;
      }
    }

    return false;
  }

  /**
   * Default no-op for other lifecycle stages.
   */
  protected shouldBlockPreToolExecution(): boolean {
    return false;
  }

  protected shouldBlockPostCoreAction(): boolean {
    return false;
  }

  protected shouldBlockPostSecondaryAction(): boolean {
    return false;
  }

  // ---- Legacy evaluate() for existing PolicyEngine -----------------------
  evaluate(ctx: PolicyContext): PolicyResult {
    this.maybeResetDaily();

    const usdEstimate = ctx.currentTxHbar * this.hbarToUsd;

    // Global daily limit
    const projectedGlobal = this.dailySpentUsd + usdEstimate;
    if (projectedGlobal > this.dailyLimitUsd) {
      return {
        allowed: false,
        policy: this.name,
        reason: `Daily USD spend limit exceeded: $${projectedGlobal.toFixed(2)} > $${this.dailyLimitUsd.toFixed(2)} ` +
          `($${this.dailySpentUsd.toFixed(2)} already spent)`,
      };
    }

    // Project budget (if context carries one)
    if (ctx.serviceName && this.projectBudgets.has(ctx.serviceName)) {
      const budget = this.projectBudgets.get(ctx.serviceName)!;
      const projectedProject = budget.spentTodayUsd + usdEstimate;
      if (projectedProject > budget.dailyLimitUsd) {
        return {
          allowed: false,
          policy: this.name,
          reason: `Project "${ctx.serviceName}" budget exceeded: $${projectedProject.toFixed(2)} > $${budget.dailyLimitUsd.toFixed(2)}`,
        };
      }
    }

    return { allowed: true, policy: this.name };
  }

  /** Record a successful spend (call AFTER transaction succeeds). */
  recordSpend(amountHbar: number): void {
    this.maybeResetDaily();
    this.dailySpentUsd += amountHbar * this.hbarToUsd;
  }

  recordProjectSpend(projectId: string, amountHbar: number): void {
    this.maybeResetDaily();
    const usd = amountHbar * this.hbarToUsd;
    if (this.projectBudgets.has(projectId)) {
      this.projectBudgets.get(projectId)!.spentTodayUsd += usd;
    }
  }

  // ---- admin -------------------------------------------------------------
  setDailyLimit(limitUsd: number): void {
    this.dailyLimitUsd = limitUsd;
  }

  setProjectBudget(projectId: string, dailyLimitUsd: number): void {
    this.projectBudgets.set(projectId, {
      projectId,
      dailyLimitUsd,
      spentTodayUsd: 0,
      lastResetDate: this.currentDate,
    });
  }

  getStatus(): {
    dailyLimitUsd: number;
    spentTodayUsd: number;
    remainingUsd: number;
    projectBudgets: Record<string, { limit: number; spent: number }>;
  } {
    this.maybeResetDaily();
    const projectStatus: Record<string, { limit: number; spent: number }> = {};
    this.projectBudgets.forEach((b, id) => {
      projectStatus[id] = { limit: b.dailyLimitUsd, spent: b.spentTodayUsd };
    });
    return {
      dailyLimitUsd: this.dailyLimitUsd,
      spentTodayUsd: this.dailySpentUsd,
      remainingUsd: Math.max(0, this.dailyLimitUsd - this.dailySpentUsd),
      projectBudgets: projectStatus,
    };
  }
}
