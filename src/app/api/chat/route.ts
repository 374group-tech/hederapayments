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
      apiKey: process.env.DEEPSEEK_API_KEY,
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
1. If a wrapped tool returns BLOCKED, respond ONLY with the block reason. NEVER say "approved" or "success" or generate fake transaction IDs.
2. Example correct response: "❌ BLOCKED by TimeWindowPolicy: Transactions only allowed 9:00–18:00 UTC (current: 19:00)."
3. Example correct response: "❌ BLOCKED by SpendLimitPolicy: 10 HBAR exceeds daily limit of 5 HBAR."
4. If a tool returns SUCCESS, report the REAL transaction ID from the tool output. NEVER invent IDs like 0.0.123456.
5. Never transfer HBAR unless the user explicitly asks and specifies both amount AND recipient.
6. Keep responses short — the user is on mobile.`,
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

    // ── Balance query interceptor (DeepSeek tool calling fallback) ──
    const balanceMatch = message.match(/\b(balance|how much hbar|check hbar)\b/i);
    let balanceResponse: string | null = null;
    if (balanceMatch) {
      try {
        const hc = getHederaClient();
        const operatorId = process.env.HEDERA_OPERATOR_ID!;
        const balance = await new AccountBalanceQuery()
          .setAccountId(operatorId)
          .execute(hc);
        balanceResponse = `💰 **Balance:** ${balance.hbars.toTinybars().divide(100_000_000).toString()} HBAR on Hedera Testnet (account ${operatorId})`;
      } catch {
        balanceResponse = null;
      }
    }

    // Run agent for reasoning (non-query tasks)
    let agentResponse = "No response from agent.";
    if (!balanceResponse) {
      const result = await ag.invoke({
        messages: [new HumanMessage(message)],
      });
      const lastMessage = result.messages?.[result.messages.length - 1];
      agentResponse = lastMessage?.content || "No response from agent.";
    }

    const finalResponse = balanceResponse || agentResponse;

    // Detect if agent was blocked by pre-execution policy gate
    const agentBlocked = /BLOCKED|🚫/.test(finalResponse);

    // Parse user intent to reflect real policy evaluation in UI
    const transferMatch = message.match(/transfer\s+(\d+(?:\.\d+)?)\s*hbar/i);
    const amountHbar = transferMatch ? parseFloat(transferMatch[1]) : 0;
    const toolName = amountHbar > 0 ? "transfer_hbar" : "chat";

    const policyResults = policyEngine.evaluate({
      toolName,
      serviceName: amountHbar > 0 ? "hedera" : "openai",
      amountHbar,
    });

    const blockedPolicies = policyResults.filter((r: any) => !r.allowed);
    const isBlocked = agentBlocked || blockedPolicies.length > 0;

    const reasons = blockedPolicies.map((r: any) => r.reason);
    if (agentBlocked && reasons.length === 0) {
      reasons.push(finalResponse.slice(0, 200));
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
