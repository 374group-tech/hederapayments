/**
 * AuditLogHook — HCS Audit Trail for Spend Guardian v2.0
 *
 * Fires at Post-Core Action stage (after transaction creation, before submit).
 * Logs every financial transaction to Hedera Consensus Service (HCS) for
 * immutable audit trail. Creates a new HCS topic on first use and caches
 * the topic ID in the HCS_AUDIT_TOPIC_ID env variable.
 *
 * This hook is non-blocking: it observes and logs; policies handle blocking.
 *
 * @stage PostCoreActionHook — fires after coreAction() creates the tx,
 *        but before secondaryAction() submits it.
 */

import {
  AbstractHook,
  type PostCoreActionParams,
} from "@hashgraph/hedera-agent-kit";
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  type Client,
} from "@hiero-ledger/sdk";

// ── Constants ────────────────────────────────────────────────────────────────

const TOPIC_MEMO = "Spend Guardian v2.0 — HCS Audit Trail";
const ENV_TOPIC_ID_KEY = "HCS_AUDIT_TOPIC_ID";

// ── In-memory topic cache (lives for duration of process) ────────────────────

let cachedTopicId: string | null = null;

// ── Helper: ensure topic exists ──────────────────────────────────────────────

async function ensureTopic(client: Client): Promise<string> {
  // 1. Try cached (in-memory)
  if (cachedTopicId) return cachedTopicId;

  // 2. Try env (survives restarts)
  const envId = process.env[ENV_TOPIC_ID_KEY];
  if (envId) {
    cachedTopicId = envId;
    return envId;
  }

  // 3. Create a new HCS topic on Hedera
  console.log("[AuditLogHook] Creating new HCS audit topic…");

  const tx = await new TopicCreateTransaction()
    .setTopicMemo(TOPIC_MEMO)
    .setSubmitKey(client.operatorPublicKey!)
    .execute(client);

  const receipt = await tx.getReceipt(client);
  const topicId = receipt.topicId!.toString();

  // Persist across restarts via env and in-memory
  process.env[ENV_TOPIC_ID_KEY] = topicId;
  cachedTopicId = topicId;

  console.log(`[AuditLogHook] HCS audit topic ready: ${topicId}`);
  return topicId;
}

// ── Helper: extract value from normalised params ─────────────────────────────

function extractAmount(params: Record<string, unknown>): number | undefined {
  // Try common keys used across different HAK tools
  const raw =
    params.amount ??
    params.hbarAmount ??
    params.initialBalance ??
    params.maxTransactionFee;

  if (raw === undefined || raw === null) return undefined;

  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  // Long / Hbar / BigNumber objects
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.toBigNumber === "function") {
      const bn = (obj as any).toBigNumber();
      return bn?.toNumber?.() ?? undefined;
    }
    if (typeof obj.toNumber === "function") {
      return (obj as any).toNumber();
    }
    if (typeof obj.toString === "function") {
      const n = Number((obj as any).toString());
      return Number.isNaN(n) ? undefined : n;
    }
  }

  return undefined;
}

function extractRecipient(params: Record<string, unknown>): string | undefined {
  const raw =
    params.recipientId ??
    params.accountId ??
    params.toAccountId ??
    params.tokenId ??
    params.recipientAddress ??
    params.toAddress ??
    params.recipient;

  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as any).toString === "function") {
    return (raw as any).toString();
  }

  return undefined;
}

// ── Hook: AuditLogHook ───────────────────────────────────────────────────────

export class AuditLogHook extends AbstractHook {
  readonly name = "AuditLogHook";
  readonly description =
    "Logs all financial transactions to HCS (Hedera Consensus Service) for immutable audit trail.";

  /**
   * Tools this hook monitors. Add/remove as needed per deployment.
   * The wildcard "*" means "all tools". For finer-grained control,
   * list specific tool names e.g. ["transfer_hbar", "transfer_token"].
   */
  relevantTools: string[];

  /**
   * Documented lifecycle stage — fires at Post-Core Action.
   * Not used by HAK engine directly; informational for operators.
   */
  readonly stage = "postCoreAction";

  constructor(relevantTools?: string[]) {
    super();
    this.relevantTools = relevantTools ?? ["*"];
  }

  /**
   * Core hook: fires AFTER the transaction object is built (coreAction)
   * but BEFORE it's submitted to the network (secondaryAction).
   *
   * Logs normalised parameters, amount, recipient, and timestamp.
   */
  async postCoreActionHook(
    params: PostCoreActionParams,
    method: string,
  ): Promise<void> {
    // Check if this tool is relevant (wildcard "*" matches all)
    if (
      !this.relevantTools.includes("*") &&
      !this.relevantTools.includes(method)
    ) {
      return;
    }

    try {
      const topicId = await ensureTopic(params.client);
      const normalisedParams =
        (params.normalisedParams as Record<string, unknown>) ?? {};

      const auditEntry = {
        // Header
        hook: this.name,
        version: "2.0",
        timestamp: new Date().toISOString(),

        // Context
        tool: method,
        operator: params.client.operatorAccountId?.toString() ?? "unknown",

        // Transaction details
        amount: extractAmount(normalisedParams) ?? null,
        recipient: extractRecipient(normalisedParams) ?? null,

        // Full params for forensic analysis
        params: sanitiseParams(normalisedParams),
      };

      const message = JSON.stringify(auditEntry);

      const tx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(message)
        .execute(params.client);

      const receipt = await tx.getReceipt(params.client);

      if (receipt.status.toString() === "SUCCESS") {
        console.log(
          `[AuditLogHook] Logged ${method} → HCS topic ${topicId} (seq: ${receipt.topicSequenceNumber})`,
        );
      } else {
        console.error(
          `[AuditLogHook] HCS submit failed for ${method}: ${receipt.status.toString()}`,
        );
      }
    } catch (error) {
      // Non-blocking: log and continue. The transaction still proceeds.
      console.error(
        `[AuditLogHook] Error logging ${method} to HCS:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

// ── Helper: sanitise params for safe serialisation ───────────────────────────

function sanitiseParams(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;

    // Convert Hedera SDK objects to their string representation
    if (value === null) {
      result[key] = null;
    } else if (value instanceof Uint8Array) {
      result[key] = `0x${Buffer.from(value).toString("hex")}`;
    } else if (typeof value === "object" && typeof (value as any).toString === "function") {
      // AccountId, TokenId, TopicId, Hbar, PublicKey, etc.
      result[key] = (value as any).toString();
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) => {
        if (typeof v === "object" && v !== null && typeof (v as any).toString === "function") {
          return (v as any).toString();
        }
        return v;
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}
