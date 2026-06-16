import { NextRequest, NextResponse } from "next/server";
import { createAuditTopic, logAuditEvent } from "@/lib/hcs-audit";
import { policyEngine } from "@/lib/policy-engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message } = body;

    // Initialize HCS topic (lazy, first call)
    let topicId: string;
    try {
      topicId = await createAuditTopic();
    } catch {
      topicId = "pending";
    }

    // Evaluate policies for the request
    const policyResults = policyEngine.evaluate({
      toolName: "chat",
      serviceName: "openai",
      amountHbar: 0,
    });

    const blocked = policyResults.filter(r => !r.allowed);
    if (blocked.length > 0) {
      return NextResponse.json({
        blocked: true,
        reasons: blocked.map(r => r.reason),
        policyResults,
        topicId,
      });
    }

    // Log audit event
    try {
      await logAuditEvent({
        tool: "chat",
        action: "message_received",
        result: "allowed",
        details: `User message: ${message?.slice(0, 100)}`,
      });
    } catch {
      // Non-blocking audit failure
    }

    // For now, echo response (LLM integration next commit)
    const response = `Policy check passed. All 3 policies approved. HCS topic: ${topicId}. Your message: "${message}"`;

    return NextResponse.json({
      message: response,
      policyResults,
      topicId,
      status: policyEngine.getStatus(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Internal error", details: error.message },
      { status: 500 }
    );
  }
}
