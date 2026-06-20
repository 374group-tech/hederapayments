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

let agent: any = null;
let toolkit: HederaLangchainToolkit | null = null;

async function getAgent() {
  if (agent) return agent;

  const client = getHederaClient();

  toolkit = new HederaLangchainToolkit({
    client,
    configuration: {
      tools: [
        "get_hbar_balance",
        "get_account_info",
        "transfer_hbar",
        "get_token_balance",
        "get_topic_info",
        "submit_topic_message",
      ],
    },
  });

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

  // Bind tools properly so DeepSeek uses native function calling, not text output
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
    messageModifier: `You are Hedera Spend Guardian — an AI agent on Hedera Testnet guarded by HAK v4 policies.

AVAILABLE TOOLS (ALL policy-gated):
- get_hbar_balance — check balances
- transfer_hbar — send HBAR (BLOCKED if policies fail)
- get_account_info — query accounts
- submit_topic_message — HCS audit logging

CRITICAL RULES (violate = DISQUALIFICATION):
1. If a wrapped tool returns BLOCKED, copy the EXACT block reason from the tool output word-for-word. NEVER rewrite, paraphrase, or invent a reason.
2. NEVER say "I'll process/attempt/check" before a transfer — always execute first, then report result.
3. NEVER output XML (<function_calls>, <invoke>) or JSON — execute the tool directly via function calling.
4. If a tool returns SUCCESS, report the REAL transaction ID from the tool output. NEVER invent IDs.
5. For transfers, ALWAYS include the HashScan link: https://hashscan.io/testnet/transaction/<txId>
6. Never transfer HBAR unless the user explicitly asks and specifies both amount AND recipient.
7. Keep responses short — the user is on mobile.
8. Report policy blocks in plain text: "BLOCKED by SpendLimitPolicy: 0.35 HBAR exceeds daily limit of 5 HBAR (5 already spent)."
  });

  return agent;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const ag = await getAgent();
    const topicId = await createAuditTopic().catch(() => "pending");

    // ── Parse user intent FIRST (used by all interceptors) ──
    // Match: transfer, send, pay, move — with optional "to"
    const transferMatch = message.match(/(?:transfer|send|pay|move)\s+(\d+(?:\.\d+)?)\s*hbar/i);
    const amountHbar = transferMatch ? parseFloat(transferMatch[1]) : 0;
    const toolName = amountHbar > 0 ? "transfer_hbar" : "chat";

    let directResponse: string | null = null;
    let isBlocked = false;
    let reasons: string[] = [];

    // ── Interceptor 1: Transfer → policy check BEFORE agent (no raw XML) ──
    if (amountHbar > 0) {
      const xferResults = policyEngine.evaluate({
        toolName: "transfer_hbar",
        serviceName: "hedera",
        amountHbar,
      });
      const blockers = xferResults.filter((r: any) => !r.allowed);
      if (blockers.length > 0) {
        reasons = blockers.map((r: any) => r.reason);
        directResponse = "BLOCKED by policies:\n• " + reasons.join("\n• ");
        isBlocked = true;
      }
    }

    // ── Interceptor 2: Balance query (DeepSeek tool calling fallback) ──
    if (!directResponse && /\b(balance|how much hbar|check hbar)\b/i.test(message)) {
      try {
        const hc = getHederaClient();
        const operatorId = process.env.HEDERA_OPERATOR_ID!;
        const bal = await new AccountBalanceQuery()
          .setAccountId(operatorId)
          .execute(hc);
        directResponse = "Balance: " + bal.hbars.toTinybars().divide(100_000_000).toString() + " HBAR on Hedera Testnet (account " + operatorId + ")";
      } catch {
        directResponse = null;
      }
    }

    // ── Interceptor 3: Account info query ──
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

    // - Run agent OR use direct response -
    let agentResponse = "";
    let txId: string | null = null;
    // Skip agent when blocked by policy - no point calling LLM
    if (!directResponse) {
      const result = await ag.invoke({
        messages: [new HumanMessage(message)],
      });
      const lastMessage = result.messages?.[result.messages.length - 1];
      agentResponse = lastMessage?.content || "No response from agent.";

      // DeepSeek fallback: parse tool call from JSON/XML text output
      // JSON format: ```json { "tool": "transfer_hbar", "parameters": {...} }
      // XML format:  <function_calls><invoke name="transfer_hbar"><parameter name="amount">0.35</parameter>...
      let parsedAmount = null as number | null;
      let parsedRecipient = null as string | null;

      const jsonMatch = agentResponse.match(/```json\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try {
          const p = JSON.parse(jsonMatch[1]);
          if (p?.tool === "transfer_hbar" || p?.name === "transfer_hbar") {
            parsedAmount = Number(p?.parameters?.amount);
            parsedRecipient = String(p?.parameters?.recipient || "");
          }
        } catch { /* not valid JSON */ }
      }

      // XML fallback — DeepSeek sometimes outputs <function_calls> instead of JSON
      if (!parsedAmount) {
        const xmlMatch = agentResponse.match(/<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/);
        if (xmlMatch && xmlMatch[1] === "transfer_hbar") {
          const inner = xmlMatch[2];
          const amtMatch = inner.match(/<parameter\s+name="amount"[^>]*>([^<]+)<\/parameter>/);
          const recMatch = inner.match(/<parameter\s+name="recipient"[^>]*>([^<]+)<\/parameter>/);
          if (amtMatch) parsedAmount = Number(amtMatch[1]);
          if (recMatch) parsedRecipient = String(recMatch[1]);
        }
      }

      // Also try bare XML inline: <transfer_hbar amount="0.35" recipient="0.0.54321" />
      if (!parsedAmount) {
        const bareMatch = agentResponse.match(/<transfer_hbar\s+amount="([^"]+)"\s+recipient="([^"]+)"\s*\/?>/);
        if (bareMatch) {
          parsedAmount = Number(bareMatch[1]);
          parsedRecipient = String(bareMatch[2]);
        }
      }

      if (parsedAmount && parsedAmount > 0 && parsedRecipient && !isBlocked) {
        try {
          const hc = getHederaClient();
          const { TransferTransaction, Hbar } = await import("@hiero-ledger/sdk");
          const senderId = process.env.HEDERA_OPERATOR_ID!;
          const tx = await new TransferTransaction()
            .addHbarTransfer(senderId, new Hbar(-parsedAmount))
            .addHbarTransfer(parsedRecipient, new Hbar(parsedAmount))
            .execute(hc);
          const receipt = await tx.getReceipt(hc);
          txId = tx.transactionId.toString();
          agentResponse =
            "Transfer successful!\n" +
            "To: " + parsedRecipient + "\n" +
            "Amount: " + parsedAmount + " HBAR\n" +
            "HashScan: https://hashscan.io/testnet/transaction/" + txId;
        } catch (txErr: any) {
          agentResponse = "Transfer parsed but execution failed: " + (txErr?.message || String(txErr));
        }
      }
    }

    const finalResponse = directResponse || agentResponse;

    // Detect blocked from wrapped tool output
    if (/BLOCKED/i.test(finalResponse)) {
      isBlocked = true;
    }

    // Policy results for UI panel
    const policyResults = policyEngine.evaluate({
      toolName,
      serviceName: amountHbar > 0 ? "hedera" : "openai",
      amountHbar,
    });

    const blockedPolicies = policyResults.filter((r: any) => !r.allowed);
    if (isBlocked && reasons.length === 0) {
      reasons = blockedPolicies.map((r: any) => r.reason);
    }

    // Log audit event
    await logAuditEvent({
      tool: "chat",
      action: "conversation_turn",
      result: isBlocked ? "blocked" : "allowed",
      details: JSON.stringify({
        userMessage: message.slice(0, 200),
        agentResponse: finalResponse.slice(0, 200),
      }),
    }).catch(() => {});

    return NextResponse.json({
      message: finalResponse,
      blocked: isBlocked,
      reasons,
      policyResults,
      topicId,
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
