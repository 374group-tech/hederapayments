import { SpendLimitPolicy } from "./policies/spend-limit";
import { ServiceAllowPolicy } from "./policies/service-allow";
import { TimeWindowPolicy } from "./policies/time-window";
import { MaxSpendPolicy } from "./policies/max-spend";
import { AllowlistPolicy } from "./policies/allowlist";
import type { PolicyResult, PolicyContext } from "./policies/types";

export class PolicyEngine {
  private spendLimit: SpendLimitPolicy;
  private serviceAllow: ServiceAllowPolicy;
  private timeWindow: TimeWindowPolicy;
  // v2.0 advanced policies (HAK AbstractPolicy) — exposed in status for UI/transparency
  private maxSpend: MaxSpendPolicy;
  private allowlist: AllowlistPolicy;

  private dailyTotal: number = 0;

  constructor() {
    this.spendLimit = new SpendLimitPolicy();
    this.serviceAllow = new ServiceAllowPolicy();
    this.timeWindow = new TimeWindowPolicy();
    this.maxSpend = new MaxSpendPolicy();
    this.allowlist = new AllowlistPolicy();
  }

  evaluate(params: {
    amountHbar?: number;
    serviceName?: string;
    toolName?: string;
    recipientId?: string;
  }): PolicyResult[] {
    const ctx: PolicyContext = {
      dailySpentHbar: this.dailyTotal,
      currentTxHbar: params.amountHbar ?? 0,
      serviceName: params.serviceName,
      toolName: params.toolName,
      recipientId: params.recipientId,
      hour: new Date().getUTCHours(),
    };

    const results = [
      this.spendLimit.evaluate(ctx),
      this.serviceAllow.evaluate(ctx),
      this.timeWindow.evaluate(ctx),
      this.maxSpend.evaluate(ctx),
      this.allowlist.evaluate(ctx),
    ];

    return results;
  }

  getStatus() {
    const maxSpendStatus = this.maxSpend.getStatus();
    const allowlistStatus = this.allowlist.getStatus();
    return {
      spendLimit: {
        dailyLimit: this.spendLimit.dailyLimit,
        perTxLimit: this.spendLimit.perTxLimit,
        spentToday: this.dailyTotal,
      },
      serviceAllow: {
        allowedServices: Array.from(this.serviceAllow.allowedServices),
      },
      timeWindow: {
        startHour: this.timeWindow.startHour,
        endHour: this.timeWindow.endHour,
      },
      maxSpend: maxSpendStatus,
      allowlist: allowlistStatus,
    };
  }

  recordSpend(amountHbar: number) {
    this.dailyTotal += amountHbar;
  }
}

export const policyEngine = new PolicyEngine();
