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

// ─────────────────────────────────────────────────────────────
// MODEL ROUTING: DeepSeek for everything, Claude for transfers
// ─────────────────────────────────────────────────────────────

let deepseekAgent: any = null;
let claudeAgent: any = null;
let toolkit: HederaLangchainToolkit | null = null;

const SYSTEM_PROMPT = [
  "You are Hedera Spend Guardian - an AI agent on Hedera Testnet guarded by HAK v4 policies.",
  "",
  "AVAILABLE TOOLS (ALL policy-gated):",
  "- get_hbar_balance - check balances",
  "- transfer_hbar - send HBAR (BLOCKED if policies fail)",
  "- get_account_info - query accounts",
  "- submit_topic_message - HCS audit logging",
  "",
  "CRITICAL RULES (violate = DISQUALIFICATION):",
  "1. If a wrapped tool returns BLOCKED, copy the EXACT block reason from the tool output word-for-word.",
  "2. NEVER say you will process/attempt/check before a transfer - always execute first, then report.",
  "3. NEVER output XML or JSON function calls as text - execute tools directly via function calling.",
  "4. If a tool returns SUCCESS, report the REAL transaction ID from the tool output. NEVER invent IDs.",
  "5. For transfers, ALWAYS include the HashScan link: https://hashscan.io/testnet/transaction/TXID",
  "6. Never transfer HBAR unless the user explicitly asks and specifies both amount AND recipient.",
  "7. Keep responses short - the user is on mobile.",
].join("\n");

function buildAgent(model: string, temp = 0) {
  if (!toolkit) {
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
  }

  const llm = new ChatOpenAI({
    model,
    temperature: temp,
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

  return createReactAgent({
    llm: llmWithTools,
    tools: guardedTools,
    messageModifier: SYSTEM_PROMPT,
  });
}

async function getDeepSeekAgent() {
  if (!deepseekAgent) {
    deepseekAgent = buildAgent("deepseek-ai/DeepSeek-V4-Pro");
  }
  return deepseekAgent;
}

async function getClaudeAgent() {
  if (!claudeAgent) {
    claudeAgent = buildAgent("claude-opus-4-8");
  }
  return claudeAgent;
}

// ─────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Parse user intent FIRST (used by all interceptors)
    const transferMatch = message.match(/(?:transfer|send|pay|move)\s+(\d+(?:\.\d+)?)\s*hbar/i);
    const amountHbar = transferMatch ? parseFloat(transferMatch[1]) : 0;
    const toolName = amountHbar > 0 ? "transfer_hbar" : "chat";

    let directResponse: string | null = null;
    let isBlocked = false;
    let reasons: string[] = [];

    // ── Interceptor 1: Transfer policy check BEFORE agent ──
    if (amountHbar > 0) {
      const xferResults = policyEngine.evaluate({
        toolName: "transfer_hbar",
        serviceName: "hedera",
        amountHbar,
      });
      const blockers = xferResults.filter((r: any) => !r.allowed);
      if (blockers.length > 0) {
        reasons = blockers.map((r: any) => r.reason);
        directResponse = "BLOCKED by policies:\n- " + reasons.join("\n- ");
        isBlocked = true;
      }
    }

    // ── Interceptor 2: Balance query (DeepSeek - cheap) ──
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

    // ── Interceptor 3: Account info query (DeepSeek - cheap) ──
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

    // ── MODEL ROUTING: run agent ──
    let agentResponse = "";
    let txId: string | null = null;

    if (!directResponse) {
      // TRANSFER: use Claude (reliable function calling, ~$0.015/request)
      // NON-TRANSFER: use DeepSeek (cheap, ~$0.001/request)
      const isTransfer = amountHbar > 0;
      const ag = isTransfer ? await getClaudeAgent() : await getDeepSeekAgent();

      const topicId = await createAuditTopic().catch(() => "pending");

      const result = await ag.invoke({
        messages: [new HumanMessage(message)],
      });

      // Parse tool calls from LangChain AIMessage format
      const lastMessage = result.messages?.[result.messages.length - 1];
      agentResponse = lastMessage?.content || "No response from agent.";

      // Extract transaction ID from tool call results
      if (isTransfer && result.messages) {
        for (const msg of result.messages) {
          if (msg?.name === "transfer_hbar" && msg?.content) {
            try {
              const tc = JSON.parse(msg.content);
              if (tc?.transactionId) {
                txId = tc.transactionId;
                agentResponse =
                  "Transfer successful!\n" +
                  "To: " + (tc.recipient || "recipient") + "\n" +
                  "Amount: " + amountHbar + " HBAR\n" +
                  "HashScan: https://hashscan.io/testnet/transaction/" + txId;
              }
            } catch { /* parse failure */ }
          }
        }
      }

      // DeepSeek fallback: parse tool call from text output (XML/JSON)
      // Only needed for DeepSeek - Claude uses native function calling
      if (!isTransfer && !txId && amountHbar > 0) {
        let parsedAmount: number | null = null;
        let parsedRecipient: string | null = null;

        // Try JSON fenced block
        const jsonStart = agentResponse.indexOf("```json");
        if (jsonStart !== -1) {
          const jsonEnd = agentResponse.indexOf("```", jsonStart + 7);
          if (jsonEnd !== -1) {
            try {
              const jsonStr = agentResponse.substring(jsonStart + 7, jsonEnd).trim();
              const p = JSON.parse(jsonStr);
              if (p?.tool === "transfer_hbar" || p?.name === "transfer_hbar") {
                parsedAmount = Number(p?.parameters?.amount);
                parsedRecipient = String(p?.parameters?.recipient || "");
              }
            } catch { /* not valid JSON */ }
          }
        }

        // Try XML invoke
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

        // Try bare XML
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
    }

    const finalResponse = directResponse || agentResponse;

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
        model: amountHbar > 0 ? "claude" : "deepseek",
      }),
    }).catch(() => {});

    return NextResponse.json({
      message: finalResponse,
      blocked: isBlocked,
      reasons,
      policyResults,
      topicId: "pending",
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
