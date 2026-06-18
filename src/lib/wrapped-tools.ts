/**
 * Pre-Execution Policy Gate — Tool Wrapper for HAK v4
 *
 * Fixes the Post→Pre execution gap: instead of running policies AFTER
 * the agent acts, this wraps every financial tool so that policyEngine
 * blocks the call BEFORE any on-chain transaction is submitted.
 *
 * How it works:
 *   Agent calls wrappedTool.invoke({amount: 10})
 *     → policyEngine.evaluate({amountHbar: 10, toolName: "transfer_hbar"})
 *       → BLOCKED: returns error string (no real call made)
 *       → ALLOWED:  delegates to original HAK tool → on-chain tx
 *
 * This is the single most impactful fix for the bounty submission —
 * it transforms the policy engine from a "logger" into a real "guard".
 */

import { StructuredTool } from "@langchain/core/tools";
import { policyEngine } from "./policy-engine";

/** Extract HBAR amount from tool input (handles number, string, or nested). */
function extractAmount(input: Record<string, unknown>): number {
  const raw = input.amount ?? input.amountHbar ?? input.hbarAmount ?? 0;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  return typeof raw === "number" ? raw : 0;
}

/** Wrap a single HAK tool with pre-execution policy check. */
export function createGuardedTool(
  original: StructuredTool,
): StructuredTool {
  return Object.assign(
    Object.create(Object.getPrototypeOf(original)),
    original,
    {
      async invoke(
        input: string | Record<string, unknown>,
        config?: unknown,
      ): Promise<string> {
        const parsed: Record<string, unknown> =
          typeof input === "string" ? JSON.parse(input) : input;
        const amountHbar = extractAmount(parsed);

        // ── PRE-EXECUTION POLICY GATE ──
        const results = policyEngine.evaluate({
          toolName: original.name,
          amountHbar,
          serviceName: "hedera",
          recipientId:
            (parsed.recipientId as string) ??
            undefined,
        });

        const blocked = results.filter((r) => !r.allowed);
        if (blocked.length > 0) {
          const reasons = blocked
            .map((r) => r.reason ?? r.policy)
            .join("; ");
          return JSON.stringify({
            blocked: true,
            reason: `🚫 Pre-execution policy block: ${reasons}`,
            policyResults: results,
          });
        }

        // ── ALLOWED: delegate to real tool ──
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (original as any).invoke(parsed, config);

        if (amountHbar > 0) {
          policyEngine.recordSpend(amountHbar);
        }

        return result;
      },
    },
  );
}

const FINANCIAL_TOOLS = new Set([
  "transfer_hbar",
  "transfer_token",
  "submit_topic_message",
]);

/** Wrap all financial tools in a HAK toolkit with pre-execution gates. */
export function wrapFinancialTools(
  tools: StructuredTool[],
): StructuredTool[] {
  return tools.map((tool) =>
    FINANCIAL_TOOLS.has(tool.name) ? createGuardedTool(tool) : tool,
  );
}
