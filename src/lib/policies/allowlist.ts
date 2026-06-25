/**
 * AllowlistPolicy — Only approved counterparties (Hedera accounts) and
 * API providers (DeepSeek, OpenAI, Tavily, etc.) can receive funds.
 *
 * HAK v4 integration: extends AbstractPolicy, blocks at PreToolExecution
 * (checks before params are normalised to save processing).
 */
import { AbstractPolicy } from "@hashgraph/hedera-agent-kit";
import type { PreToolExecutionParams } from "@hashgraph/hedera-agent-kit";
import type { PolicyResult, PolicyContext } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AllowlistPolicyOptions {
  /** Set of Hedera account IDs allowed to receive transfers. */
  accountIds?: string[];
  /** Set of API provider names (DeepSeek, OpenAI, Tavily, etc.). */
  apiProviders?: string[];
  /** Whether to block if neither allowlist matches (default true). */
  strictMode?: boolean;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export class AllowlistPolicy extends AbstractPolicy {
  readonly name = "AllowlistPolicy";
  readonly description =
    "Blocks transfers to unauthorized counterparties and blocks payments to unapproved API providers.";

  readonly relevantTools = [
    "transfer_hbar",
    "transfer_hbar_with_allowance",
    "transfer_fungible_token",
    "transfer_fungible_token_with_allowance",
    "airdrop_fungible_token",
    "transfer_non_fungible_token",
    "create_account",
  ];

  private allowedAccountIds: Set<string>;
  private allowedApiProviders: Set<string>;
  private strictMode: boolean;

  constructor(options: AllowlistPolicyOptions = {}) {
    super();

    this.allowedAccountIds = new Set(
      (options.accountIds ?? []).map((id) => id.toLowerCase()),
    );

    this.allowedApiProviders = new Set(
      (options.apiProviders ?? [
        "deepseek",
        "openai",
        "tavily",
        "hedera",
      ]).map((p) => p.toLowerCase()),
    );

    this.strictMode = options.strictMode ?? true;
  }

  // ---- account ID extraction -----------------------------------------------

  /**
   * Try to extract a recipient account ID from tool params.
   * Tools use different param shapes — we sniff for common keys.
   */
  private extractRecipientId(
    rawParams: Record<string, unknown>,
  ): string | undefined {
    const keys = [
      "recipientId",
      "recipientAccountId",
      "toAccountId",
      "accountId",
      "ownerAccountId",
      "newAccountId",
    ];
    for (const key of keys) {
      const val = rawParams[key];
      if (typeof val === "string" && val.length > 0) return val;
    }

    // Airdrop: recipients array
    const recipients = rawParams.recipients;
    if (Array.isArray(recipients)) {
      return (recipients as Array<Record<string, unknown>>)
        .map((r) => r.accountId as string)
        .filter(Boolean)
        .join(",");
    }

    return undefined;
  }

  /**
   * Try to extract a service/provider name for non-transfer tools.
   */
  private extractServiceName(
    rawParams: Record<string, unknown>,
  ): string | undefined {
    const keys = ["serviceName", "provider", "apiName", "toolName"];
    for (const key of keys) {
      const val = rawParams[key];
      if (typeof val === "string" && val.length > 0) return val;
    }
    return undefined;
  }

  // ---- checks ---------------------------------------------------------------

  /**
   * Check if a single account ID is in the allowlist.
   * Supports wildcards: "*" means allow all.
   */
  private isAccountAllowed(accountId: string): boolean {
    if (this.allowedAccountIds.has("*")) return true;
    return this.allowedAccountIds.has(accountId.toLowerCase());
  }

  /**
   * Check if an API provider is in the allowlist.
   */
  private isApiProviderAllowed(provider: string): boolean {
    if (this.allowedApiProviders.has("*")) return true;
    return this.allowedApiProviders.has(provider.toLowerCase());
  }

  /**
   * Check if a (possibly comma-separated) list of account IDs are all allowed.
   */
  private areAllAccountsAllowed(accountIds: string): boolean {
    const ids = accountIds.split(",").map((s) => s.trim()).filter(Boolean);
    return ids.every((id) => this.isAccountAllowed(id));
  }

  // ---- HAK v4 Policy hooks --------------------------------------------------

  protected shouldBlockPreToolExecution(
    params: PreToolExecutionParams,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _method: string,
  ): boolean {
    if (!this.strictMode) return false;

    const rp = (params.rawParams ?? {}) as Record<string, unknown>;

    // Check service/provider (API payments)
    const serviceName = this.extractServiceName(rp);
    if (serviceName) {
      if (!this.isApiProviderAllowed(serviceName)) {
        console.warn(
          `[AllowlistPolicy] BLOCKED — API provider "${serviceName}" not in allowlist: ` +
            `[${Array.from(this.allowedApiProviders).join(", ")}]`,
        );
        return true;
      }
    }

    // Check account IDs (transfers)
    const recipientId = this.extractRecipientId(rp);
    if (recipientId) {
      if (!this.areAllAccountsAllowed(recipientId)) {
        console.warn(
          `[AllowlistPolicy] BLOCKED — recipient(s) "${recipientId}" not in account allowlist`,
        );
        return true;
      }
    }

    return false;
  }

  protected shouldBlockPostParamsNormalization(): boolean {
    return false;
  }

  protected shouldBlockPostCoreAction(): boolean {
    return false;
  }

  protected shouldBlockPostSecondaryAction(): boolean {
    return false;
  }

  // ---- Legacy evaluate() for existing PolicyEngine ------------------------

  evaluate(ctx: PolicyContext): PolicyResult {
    if (!this.strictMode) {
      return { allowed: true, policy: this.name };
    }

    // Check service name
    if (ctx.serviceName) {
      if (!this.isApiProviderAllowed(ctx.serviceName)) {
        return {
          allowed: false,
          policy: this.name,
          reason: `Service "${ctx.serviceName}" is not in the API provider allowlist: ` +
            `[${Array.from(this.allowedApiProviders).join(", ")}]`,
        };
      }
    }

    // Check recipient account ID
    if (ctx.recipientId) {
      if (!this.areAllAccountsAllowed(ctx.recipientId)) {
        return {
          allowed: false,
          policy: this.name,
          reason: `Recipient "${ctx.recipientId}" is not in the account allowlist`,
        };
      }
    }

    return { allowed: true, policy: this.name };
  }

  // ---- admin -----------------------------------------------------------------

  addAccount(accountId: string): void {
    this.allowedAccountIds.add(accountId.toLowerCase());
  }

  removeAccount(accountId: string): void {
    this.allowedAccountIds.delete(accountId.toLowerCase());
  }

  addApiProvider(provider: string): void {
    this.allowedApiProviders.add(provider.toLowerCase());
  }

  removeApiProvider(provider: string): void {
    this.allowedApiProviders.delete(provider.toLowerCase());
  }

  setStrictMode(enabled: boolean): void {
    this.strictMode = enabled;
  }

  getStatus(): {
    accountIds: string[];
    apiProviders: string[];
    strictMode: boolean;
  } {
    return {
      accountIds: Array.from(this.allowedAccountIds).sort(),
      apiProviders: Array.from(this.allowedApiProviders).sort(),
      strictMode: this.strictMode,
    };
  }
}
