/// <reference types="vitest" />
import { describe, it, expect, beforeEach } from "vitest";
import { SpendLimitPolicy } from "../src/lib/policies/spend-limit";
import { ServiceAllowPolicy } from "../src/lib/policies/service-allow";
import { TimeWindowPolicy } from "../src/lib/policies/time-window";
import { PolicyEngine } from "../src/lib/policy-engine";
import type { PolicyContext } from "../src/lib/policies/types";

// ── SpendLimitPolicy ──────────────────────────────────────────────────

describe("SpendLimitPolicy", () => {
  // Default: 5 HBAR daily, 2 HBAR per-tx
  const policy = new SpendLimitPolicy(5, 2);

  it("allows transaction under both limits", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 1,
      currentTxHbar: 1,
      hour: 14,
    };
    expect(policy.evaluate(ctx).allowed).toBe(true);
  });

  it("blocks transaction over per-tx limit", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 0,
      currentTxHbar: 3,
      hour: 14,
    };
    const result = policy.evaluate(ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Per-transaction limit exceeded");
  });

  it("blocks transaction that would exceed daily limit", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 4,
      currentTxHbar: 2,
      hour: 14,
    };
    const result = policy.evaluate(ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily spend limit");
  });

  it("allows zero-amount when not over daily limit (balance check)", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 3,
      currentTxHbar: 0,
      hour: 14,
    };
    expect(policy.evaluate(ctx).allowed).toBe(true);
  });

  it("blocks zero-amount when already over daily limit", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 6,
      currentTxHbar: 0,
      hour: 14,
    };
    expect(policy.evaluate(ctx).allowed).toBe(false);
  });
});

// ── ServiceAllowPolicy ────────────────────────────────────────────────

describe("ServiceAllowPolicy", () => {
  const policy = new ServiceAllowPolicy(["tavily", "openai", "hedera"]);

  it("allows whitelisted service", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 0,
      currentTxHbar: 0,
      serviceName: "openai",
      hour: 14,
    };
    expect(policy.evaluate(ctx).allowed).toBe(true);
  });

  it("blocks non-whitelisted service", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 0,
      currentTxHbar: 0,
      serviceName: "aws",
      hour: 14,
    };
    const result = policy.evaluate(ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in the allowed list");
  });

  it("allows undefined service (non-payment tool call)", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 0,
      currentTxHbar: 0,
      hour: 14,
    };
    expect(policy.evaluate(ctx).allowed).toBe(true);
  });
});

// ── TimeWindowPolicy ──────────────────────────────────────────────────

describe("TimeWindowPolicy", () => {
  const policy = new TimeWindowPolicy(9, 18);

  it("allows transaction during business hours", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 0,
      currentTxHbar: 1,
      hour: 14,
    };
    expect(policy.evaluate(ctx).allowed).toBe(true);
  });

  it("blocks transaction outside business hours", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 0,
      currentTxHbar: 1,
      hour: 3,
    };
    const result = policy.evaluate(ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("only allowed between");
  });

  it("allows balance query at any hour (zero-amount)", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 0,
      currentTxHbar: 0,
      hour: 3,
    };
    expect(policy.evaluate(ctx).allowed).toBe(true);
  });

  it("blocks at boundary hour (end hour)", () => {
    const ctx: PolicyContext = {
      dailySpentHbar: 0,
      currentTxHbar: 1,
      hour: 18,
    };
    expect(policy.evaluate(ctx).allowed).toBe(false);
  });
});

// ── PolicyEngine ──────────────────────────────────────────────────────

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  it("returns 3 policy results for a transaction", () => {
    const results = engine.evaluate({
      toolName: "transfer_hbar",
      amountHbar: 1,
      serviceName: "hedera",
    });
    expect(results).toHaveLength(3);
    expect(results[0].policy).toBe("SpendLimitPolicy");
    expect(results[1].policy).toBe("ServiceAllowPolicy");
    expect(results[2].policy).toBe("TimeWindowPolicy");
  });

  it("blocks over-limit transfer (SpendLimitPolicy fails first)", () => {
    const results = engine.evaluate({
      toolName: "transfer_hbar",
      amountHbar: 10,
      serviceName: "hedera",
    });
    const blockers = results.filter((r) => !r.allowed);
    expect(blockers.length).toBeGreaterThanOrEqual(1);
    expect(blockers[0].policy).toBe("SpendLimitPolicy");
  });

  it("getStatus returns all three policy statuses", () => {
    const status = engine.getStatus();
    expect(status.spendLimit.dailyLimit).toBe(5);
    expect(status.spendLimit.perTxLimit).toBe(2);
    expect(status.spendLimit.spentToday).toBe(0);
    expect(status.serviceAllow.allowedServices).toEqual(
      expect.arrayContaining(["hedera", "openai", "tavily"]),
    );
    expect(status.timeWindow.startHour).toBe(9);
    expect(status.timeWindow.endHour).toBe(18);
  });

  it("recordSpend increments daily total", () => {
    engine.recordSpend(2);
    const status = engine.getStatus();
    expect(status.spendLimit.spentToday).toBe(2);

    engine.recordSpend(1);
    expect(engine.getStatus().spendLimit.spentToday).toBe(3);
  });
});
