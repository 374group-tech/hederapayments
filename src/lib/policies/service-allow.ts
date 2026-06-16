import type { PolicyResult, PolicyContext } from "./types";

export class ServiceAllowPolicy {
  readonly name = "ServiceAllowPolicy";
  private allowedServices: Set<string>;

  constructor(allowedList?: string[]) {
    if (allowedList && allowedList.length > 0) {
      this.allowedServices = new Set(allowedList.map((s) => s.toLowerCase()));
    } else {
      // Default from env or hardcoded whitelist
      const raw = process.env.ALLOWED_SERVICES;
      if (raw) {
        this.allowedServices = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
      } else {
        this.allowedServices = new Set(["tavily", "openai", "hedera"]);
      }
    }
  }

  evaluate(ctx: PolicyContext): PolicyResult {
    const service = ctx.serviceName?.toLowerCase();
    if (!service) {
      // Non-payment tool (e.g., query) — allow
      return { allowed: true, policy: this.name };
    }

    if (!this.allowedServices.has(service)) {
      return {
        allowed: false,
        policy: this.name,
        reason: `Service "${service}" is not in the allowed list: [${Array.from(this.allowedServices).join(", ")}]`,
      };
    }

    return { allowed: true, policy: this.name };
  }
}
