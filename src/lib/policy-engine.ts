import { SpendLimitPolicy } from "./policies/spend-limit";
import { ServiceAllowPolicy } from "./policies/service-allow";
import { TimeWindowPolicy } from "./policies/time-window";
import type { PolicyResult, PolicyContext } from "./policies/types";

export class PolicyEngine {
  private spendLimit: SpendLimitPolicy;
  private serviceAllow: ServiceAllowPolicy;
  private timeWindow: TimeWindowPolicy;

  private dailyTotal: number = 0;

  constructor() {
    this.spendLimit = new SpendLimitPolicy();
    this.serviceAllow = new ServiceAllowPolicy();
    this.timeWindow = new TimeWindowPolicy();
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
    ];

    return results;
  }

  getStatus() {
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
    };
  }

  recordSpend(amountHbar: number) {
    this.dailyTotal += amountHbar;
  }
}

export const policyEngine = new PolicyEngine();
