/**
 * AlertHook — Telegram Alerts for Spend Guardian v2.0
 *
 * Fires at Post-Tool Execution stage (after the tool completes).
 * Sends real-time alerts via Telegram Bot API when:
 *   - A transaction is blocked by policy
 *   - A high-value transaction is submitted
 *   - Daily spend limit is reached
 *
 * This hook is non-blocking: it observes results and alerts;
 * policies handle blocking decisions.
 *
 * Environment variables required:
 *   TELEGRAM_BOT_TOKEN  — Your Telegram bot token from @BotFather
 *   TELEGRAM_CHAT_ID    — Target chat ID for alerts
 *
 * @stage postToolExecution — fires after secondaryAction completes.
 */

import {
  AbstractHook,
  type PostSecondaryActionParams,
} from "@hashgraph/hedera-agent-kit";

// ── Constants ────────────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = "https://api.telegram.org";
const HIGH_VALUE_THRESHOLD_HBAR = 5; // Alert on transactions >= 5 HBAR

// ── Config from environment ──────────────────────────────────────────────────

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function getTelegramConfig(): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn(
      "[AlertHook] TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID not set. Alerts disabled.",
    );
    return null;
  }

  return { botToken, chatId };
}

// ── Telegram API helper ──────────────────────────────────────────────────────

async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
): Promise<boolean> {
  try {
    const url = `${TELEGRAM_API_BASE}/bot${config.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[AlertHook] Telegram API error (${response.status}): ${error}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "[AlertHook] Failed to send Telegram message:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

// ── Message builders ─────────────────────────────────────────────────────────

function buildBlockedAlert(params: {
  tool: string;
  reason: string;
  operator: string;
}): string {
  return [
    "🛑 <b>Transaction Blocked</b>",
    "",
    `<b>Tool:</b> ${escapeHtml(params.tool)}`,
    `<b>Reason:</b> ${escapeHtml(params.reason)}`,
    `<b>Operator:</b> ${escapeHtml(params.operator)}`,
    `<b>Time:</b> ${new Date().toISOString()}`,
  ].join("\n");
}

function buildHighValueAlert(params: {
  tool: string;
  amountHbar: number;
  operator: string;
  txId?: string;
}): string {
  return [
    "⚠️ <b>High-Value Transaction</b>",
    "",
    `<b>Tool:</b> ${escapeHtml(params.tool)}`,
    `<b>Amount:</b> ${params.amountHbar} ℏ`,
    `<b>Operator:</b> ${escapeHtml(params.operator)}`,
    ...(params.txId ? [`<b>Tx ID:</b> ${escapeHtml(params.txId)}`] : []),
    `<b>Time:</b> ${new Date().toISOString()}`,
  ].join("\n");
}

function buildDailyLimitAlert(params: {
  dailySpentHbar: number;
  dailyLimitHbar: number;
  operator: string;
}): string {
  return [
    "🔴 <b>Daily Spend Limit Reached</b>",
    "",
    `<b>Spent:</b> ${params.dailySpentHbar} ℏ`,
    `<b>Limit:</b> ${params.dailyLimitHbar} ℏ`,
    `<b>Operator:</b> ${escapeHtml(params.operator)}`,
    `<b>Time:</b> ${new Date().toISOString()}`,
    "",
    "<i>No further transactions will be allowed until the daily limit resets.</i>",
  ].join("\n");
}

function buildSuccessAlert(params: {
  tool: string;
  amountHbar: number;
  operator: string;
  txId?: string;
}): string {
  return [
    "✅ <b>Transaction Succeeded</b>",
    "",
    `<b>Tool:</b> ${escapeHtml(params.tool)}`,
    `<b>Amount:</b> ${params.amountHbar} ℏ`,
    `<b>Operator:</b> ${escapeHtml(params.operator)}`,
    ...(params.txId ? [`<b>Tx ID:</b> ${escapeHtml(params.txId)}`] : []),
    `<b>Time:</b> ${new Date().toISOString()}`,
  ].join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractAmountHbar(
  toolResult: Record<string, unknown> | null | undefined,
): number | null {
  if (!toolResult) return null;

  const raw =
    toolResult.amount ??
    toolResult.hbarAmount ??
    toolResult.amountHbar;

  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function isBlocked(result: unknown): {
  blocked: boolean;
  reason?: string;
} {
  if (!result) return { blocked: false };

  // If result is a string, try parsing as JSON
  let parsed: Record<string, unknown> | null = null;
  if (typeof result === "string") {
    try {
      parsed = JSON.parse(result);
    } catch {
      // Not JSON — just check if it contains "block" keywords
      const lower = result.toLowerCase();
      if (lower.includes("block") || lower.includes("denied") || lower.includes("🚫")) {
        return { blocked: true, reason: result };
      }
      return { blocked: false };
    }
  } else if (typeof result === "object" && result !== null) {
    parsed = result as Record<string, unknown>;
  }

  if (!parsed) return { blocked: false };

  if (parsed.blocked === true || parsed.allowed === false) {
    return {
      blocked: true,
      reason:
        (parsed.reason as string) ??
        (parsed.error as string) ??
        "Transaction blocked by policy",
    };
  }

  return { blocked: false };
}

// ── Hook: AlertHook ──────────────────────────────────────────────────────────

export class AlertHook extends AbstractHook {
  readonly name = "AlertHook";
  readonly description =
    "Sends Telegram alerts on blocked transactions, high-value transfers, and daily limit breaches.";

  /**
   * Tools this hook monitors. The wildcard "*" covers all tools.
   */
  relevantTools: string[];

  /**
   * Documented lifecycle stage — fires at Post-Tool Execution.
   */
  readonly stage = "postToolExecution";

  private config: TelegramConfig | null;

  /** Daily spend tracking (in-memory, resets on process restart). */
  private dailySpentHbar = 0;
  private readonly dailyLimitHbar: number;
  private readonly highValueThresholdHbar: number;

  constructor(options?: {
    relevantTools?: string[];
    dailyLimitHbar?: number;
    highValueThresholdHbar?: number;
  }) {
    super();
    this.relevantTools = options?.relevantTools ?? ["*"];
    this.config = getTelegramConfig();
    this.dailyLimitHbar =
      options?.dailyLimitHbar ??
      Number(process.env.DAILY_SPEND_LIMIT_HBAR) ??
      5;
    this.highValueThresholdHbar =
      options?.highValueThresholdHbar ?? HIGH_VALUE_THRESHOLD_HBAR;
  }

  /**
   * Core hook: fires AFTER the tool finishes execution.
   * Checks the result for blocks, high-value amounts, and daily limits.
   */
  async postToolExecutionHook(
    params: PostSecondaryActionParams,
    method: string,
  ): Promise<void> {
    if (!this.config) return; // Telegram not configured — silently skip

    if (
      !this.relevantTools.includes("*") &&
      !this.relevantTools.includes(method)
    ) {
      return;
    }

    try {
      const operator =
        params.client.operatorAccountId?.toString() ?? "unknown";

      // Parse the tool result (may be raw bytes or already parsed)
      const toolResult: Record<string, unknown> | null =
        typeof params.toolResult === "string"
          ? (() => {
              try {
                return JSON.parse(params.toolResult);
              } catch {
                return null;
              }
            })()
          : (params.toolResult as Record<string, unknown> | null);

      const rawResult = params.toolResult?.raw ?? params.toolResult;

      // 1. Check for blocked transactions
      const blockCheck = isBlocked(
        typeof params.toolResult === "object" &&
          params.toolResult !== null &&
          "humanMessage" in params.toolResult
          ? (params.toolResult as unknown).humanMessage
          : (typeof rawResult === "object" && rawResult !== null
              ? (rawResult as Record<string, unknown>)
              : rawResult),
      );

      // Also check if humanMessage indicates blocking
      const humanMessage =
        typeof params.toolResult === "object" &&
        params.toolResult !== null &&
        "humanMessage" in params.toolResult
          ? (params.toolResult as unknown).humanMessage
          : null;

      const blockedByHumanMsg =
        typeof humanMessage === "string" &&
        (humanMessage.toLowerCase().includes("block") ||
          humanMessage.toLowerCase().includes("denied") ||
          humanMessage.includes("🚫"));

      if (blockCheck.blocked || blockedByHumanMsg) {
        await sendTelegramMessage(
          this.config,
          buildBlockedAlert({
            tool: method,
            reason:
              blockCheck.reason ?? humanMessage ?? "Transaction blocked",
            operator,
          }),
        );
        return; // Don't also send success/high-value for blocked txs
      }

      // 2. Extract amount for high-value and daily-limit alerts
      const amountHbar =
        extractAmountHbar(toolResult) ??
        extractAmountHbar(
          (params.normalisedParams as Record<string, unknown> | undefined) ??
            null,
        );

      // 3. Track daily spend
      if (amountHbar && amountHbar > 0) {
        const projected = this.dailySpentHbar + amountHbar;

        // Daily limit reached alert
        if (
          this.dailySpentHbar <= this.dailyLimitHbar &&
          projected > this.dailyLimitHbar
        ) {
          await sendTelegramMessage(
            this.config,
            buildDailyLimitAlert({
              dailySpentHbar: projected,
              dailyLimitHbar: this.dailyLimitHbar,
              operator,
            }),
          );
        }

        this.dailySpentHbar = projected;

        // High-value alert
        if (amountHbar >= this.highValueThresholdHbar) {
          const txId =
            params.toolResult?.raw?.transactionId?.toString() ?? undefined;
          await sendTelegramMessage(
            this.config,
            buildHighValueAlert({
              tool: method,
              amountHbar,
              operator,
              txId,
            }),
          );
        }
      }

      // 4. Success notification for significant transactions (optional, > 1 HBAR)
      if (amountHbar && amountHbar >= 1) {
        const txId =
          params.toolResult?.raw?.transactionId?.toString() ?? undefined;
        await sendTelegramMessage(
          this.config,
          buildSuccessAlert({
            tool: method,
            amountHbar,
            operator,
            txId,
          }),
        );
      }
    } catch (error) {
      // Non-blocking: log and continue
      console.error(
        `[AlertHook] Error processing alert for ${method}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}
