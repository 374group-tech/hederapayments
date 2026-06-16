import { TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { getHederaClient } from "./hedera-client";

let auditTopicId: string | null = null;

export async function createAuditTopic(): Promise<string> {
  if (auditTopicId) return auditTopicId;

  const client = getHederaClient();
  const tx = await new TopicCreateTransaction()
    .setTopicMemo("Hedera Spend Guardian — HCS Audit Trail")
    .setSubmitKey(client.operatorPublicKey!)
    .execute(client);

  const receipt = await tx.getReceipt(client);
  auditTopicId = receipt.topicId!.toString();
  console.log(`[HCS Audit] Topic created: ${auditTopicId}`);
  return auditTopicId;
}

export async function logAuditEvent(event: {
  tool: string;
  action: string;
  result: string;
  details: string;
}): Promise<void> {
  const client = getHederaClient();
  const topicId = await createAuditTopic();

  const message = JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
    operator: process.env.HEDERA_OPERATOR_ID,
  });

  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .execute(client);

  await tx.getReceipt(client);
}

export function getAuditTopicId(): string | null {
  return auditTopicId;
}
