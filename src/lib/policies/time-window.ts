import type { PolicyResult, PolicyContext } from "./types";

export class TimeWindowPolicy {
  readonly name = "TimeWindowPolicy";
  private startHour: number;
  private endHour: number;

  constructor(startHour?: number, endHour?: number) {
    this.startHour = startHour ?? Number(process.env.BUSINESS_START_HOUR || 9);
    this.endHour = endHour ?? Number(process.env.BUSINESS_END_HOUR || 18);
  }

  evaluate(ctx: PolicyContext): PolicyResult {
    const currentHour = ctx.hour;
    if (currentHour < this.startHour || currentHour >= this.endHour) {
      return {
        allowed: false,
        policy: this.name,
        reason: `Transactions only allowed between ${this.startHour}:00–${this.endHour}:00 UTC (current: ${currentHour}:00)`,
      };
    }
    return { allowed: true, policy: this.name };
  }
}
