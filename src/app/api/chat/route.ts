import { NextRequest, NextResponse } from "next/server";
import { getHederaClient } from "@/lib/hedera-client";
import { createAuditTopic, logAuditEvent } from "@/lib/hcs-audit";
import { policyEngine } from "@/lib/policy-engine";
import { HederaLangchainToolkit } from "@hashgraph/hedera-agent-kit-langchain";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { wrapFinancialTools } from "@/lib/wrapped-tools";
import { HumanMessage } from "@langchain/core/messages";
import { AccountBalanceQuery } from "@hiero-ledger/sdk";
import { env } from "@/lib/config";

// ============================================================================
// ARCHITECTURE: Direct SDK for transfers (zero LLM), DeepSeek for chat
// ============================================================================

let agent: any = null;
let toolkit: HederaLangchainToolkit | null = null;

const SYSTEM_PROMPT = [
  "You are Hedera Spend Guardian - an AI agent on Hedera Testnet guarded by HAK v4 policies.",
  "",
  "AVAILABLE TOOLS (ALL policy-gated):",
  "- get_hbar_balance - check balances",
  "- get_account_info - query accounts",
  "- submit_topic_message - HCS audit logging",
  "",
  "CRITICAL RULES:",
  "1. NEVER attempt transfers - they are handled directly by the system.",
  "2. Keep responses short - the user is on mobile.",
  "3. For balance queries, report the exact amount from the tool output.",
].join("\n");

async function getAgent() {
  if (agent) return agent;

  if (!toolkit) {
    const client = getHederaClient();
    toolkit = new HederaLangchainToolkit({
      client,
      configuration: {
        tools: [
          "get_hbar_balance",
          "get_account_info",
          "get_token_balance",
          "get_topic_info",
          "submit_topic_message",
        ],
      },
    });
  }

  const llm = new ChatOpenAI({
    model: "deepseek-ai/DeepSeek-V4-Pro",
    temperature: 0,
    configuration: {
      baseURL: "https://api.pioneer.ai/v1",
      apiKey: env.DEEPSEEK_API_KEY,
    },
  });

  const rawTools = toolkit.getTools() as any;
  const guardedTools = wrapFinancialTools(rawTools);

  const llmWithTools = llm.bindTools(
    guardedTools.map((t: any) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.schema ?? { type: "object", properties: {} },
      },
    })),
  ) as any;

  agent = createReactAgent({
    llm: llmWithTools,
    tools: guardedTools,
    messageModifier: SYSTEM_PROMPT,
  });

  return agent;
}

// ============================================================================
// POST handler
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const topicId = await createAuditTopic().catch(() => "pending");

    // Parse user intent
    const transferMatch = message.match(/(?:transfer|send|pay|move)\s+(\d+(?:\.\d+)?)\s*hbar/i);
    const recipientMatch = message.match(/(?:to|recipient)\s+(0\.0\.\d+)/i);
    const amountHbar = transferMatch ? parseFloat(transferMatch[1]) : 0;
    const recipient = recipientMatch ? recipientMatch[1] : null;

    let directResponse: string | null = null;
    let isBlocked = false;
    let reasons: string[] = [];
    let txId: string | null = null;
    let agentResponse = "";

    // ========================================================================
    // TRANSFER: Direct SDK execution (NO LLM — 100% reliable)
    // ========================================================================
    if (amountHbar > 0 && recipient) {
      // Step 1: Policy check
      const xferResults = policyEngine.evaluate({
        toolName: "transfer_hbar",
        serviceName: "hedera",
        amountHbar,
      });
      const blockers = xferResults.filter((r: any) => !r.allowed);

      if (blockers.length > 0) {
        // BLOCKED by policy
        reasons = blockers.map((r: any) => r.reason);
        directResponse = "BLOCKED: " + blockers.map((r: any) => r.name + " - " + r.reason).join("; ");
        isBlocked = true;
      } else {
        // ALL POLICIES PASS: Execute transfer directly via Hedera SDK
        try {
          const hc = getHederaClient();
          const { TransferTransaction, Hbar } = await import("@hiero-ledger/sdk");
          const senderId = process.env.HEDERA_OPERATOR_ID!;

          const tx = await new TransferTransaction()
            .addHbarTransfer(senderId, new Hbar(-amountHbar))
            .addHbarTransfer(recipient, new Hbar(amountHbar))
            .setTransactionMemo("Spend Guardian transfer")
            .execute(hc);

          const receipt = await tx.getReceipt(hc);
          txId = tx.transactionId.toString();

          directResponse =
            "Transfer successful!\n" +
            "To: " + recipient + "\n" +
            "Amount: " + amountHbar + " HBAR\n" +
            "TxID: " + txId + "\n" +
            "HashScan: https://hashscan.io/testnet/transaction/" + txId;
        } catch (txErr: any) {
          directResponse = "Transfer failed: " + (txErr?.message || String(txErr));
          isBlocked = true;
          reasons = ["Transaction execution error"];
        }
      }
    }

    // ========================================================================
    // BALANCE QUERY: Direct SDK (NO LLM — fast + free)
    // ========================================================================
    if (!directResponse && /\b(balance|how much hbar|check hbar)\b/i.test(message)) {
      try {
        const hc = getHederaClient();
        const operatorId = process.env.HEDERA_OPERATOR_ID!;
        const bal = await new AccountBalanceQuery()
          .setAccountId(operatorId)
          .execute(hc);
        directResponse = "Balance: " + bal.hbars.toTinybars().divide(100_000_000).toString() + " HBAR\nAccount: " + operatorId + "\nNetwork: Hedera Testnet";
      } catch {
        directResponse = null;
      }
    }

    // ========================================================================
    // ACCOUNT INFO: Direct SDK (NO LLM — fast + free)
    // ========================================================================
    if (!directResponse && /\b(account info|account details|who am i)\b/i.test(message)) {
      try {
        const hc = getHederaClient();
        const operatorId = process.env.HEDERA_OPERATOR_ID!;
        const bal = await new AccountBalanceQuery()
          .setAccountId(operatorId)
          .execute(hc);
        directResponse = "Account: " + operatorId + "\nBalance: " + bal.hbars.toTinybars().divide(100_000_000).toString() + " HBAR\nNetwork: Hedera Testnet\nGuard: 5 HAK v4 policies active";
      } catch {
        directResponse = null;
      }
    }

    // ========================================================================
    // CHAT: DeepSeek agent (everything else — "what is Hedera", etc.)
    // ========================================================================
    if (!directResponse) {
      const ag = await getAgent();
      const result = await ag.invoke({
        messages: [new HumanMessage(message)],
      });
      const lastMessage = result.messages?.[result.messages.length - 1];
      agentResponse = lastMessage?.content || "No response from agent.";
    }

    const finalResponse = directResponse || agentResponse;

    if (/BLOCKED/i.test(finalResponse)) {
      isBlocked = true;
    }

    // Policy results for UI panel
    const toolName = amountHbar > 0 ? "transfer_hbar" : "chat";
    const policyResults = policyEngine.evaluate({
      toolName,
      serviceName: amountHbar > 0 ? "hedera" : "openai",
      amountHbar,
    });

    const blockedPolicies = policyResults.filter((r: any) => !r.allowed);
    if (isBlocked && reasons.length === 0) {
      reasons = blockedPolicies.map((r: any) => r.reason);
    }

    await logAuditEvent({
      tool: "chat",
      action: "conversation_turn",
      result: isBlocked ? "blocked" : "allowed",
      details: JSON.stringify({
        userMessage: message.slice(0, 200),
        agentResponse: finalResponse.slice(0, 200),
        txId: txId || "none",
      }),
    }).catch(() => {});

    return NextResponse.json({
      message: finalResponse,
      blocked: isBlocked,
      reasons,
      policyResults,
      topicId,
      txId,
      status: policyEngine.getStatus(),
    });
  } catch (error: any) {
    console.error("[Chat Error]", error);
    return NextResponse.json(
      { error: "Agent error", details: error.message },
      { status: 500 }
    );
  }
}
