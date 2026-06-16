import { NextRequest, NextResponse } from "next/server";
import { getHederaClient } from "@/lib/hedera-client";
import { createAuditTopic, logAuditEvent } from "@/lib/hcs-audit";
import { policyEngine } from "@/lib/policy-engine";
import { HederaLangchainToolkit } from "@hashgraph/hedera-agent-kit-langchain";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";

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
    modelName: "gpt-4o-mini",
    temperature: 0,
  });

  agent = createReactAgent({
    llm,
    tools: toolkit.getTools(),
    messageModifier: `You are Hedera Spend Guardian, an AI agent with policy-enforced access to Hedera Testnet.
You can check balances, transfer HBAR, and interact with HCS topics.
Every transaction you propose must go through policy checks.
Keep responses concise and helpful.`,
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

    // Run agent
    const result = await ag.invoke({
      messages: [new HumanMessage(message)],
    });

    const lastMessage = result.messages?.[result.messages.length - 1];
    const agentResponse = lastMessage?.content || "No response from agent.";

    // Evaluate policies
    const policyResults = policyEngine.evaluate({
      toolName: "chat",
      serviceName: "openai",
      amountHbar: 0,
    });

    const blocked = policyResults.filter((r) => !r.allowed);

    // Log audit event
    await logAuditEvent({
      tool: "chat",
      action: "conversation_turn",
      result: blocked.length > 0 ? "blocked" : "allowed",
      details: JSON.stringify({
        userMessage: message.slice(0, 200),
        agentResponse: agentResponse.slice(0, 200),
      }),
    }).catch(() => {});

    return NextResponse.json({
      message: agentResponse,
      blocked: blocked.length > 0,
      reasons: blocked.map((r) => r.reason),
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
