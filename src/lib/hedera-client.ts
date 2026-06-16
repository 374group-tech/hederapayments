import { Client, AccountId, PrivateKey, Hbar } from "@hiero-ledger/sdk";
import { env } from "./config";

let client: Client | null = null;

export function getHederaClient(): Client {
  if (client) return client;

  const operatorId = AccountId.fromString(env.HEDERA_OPERATOR_ID);
  const operatorKey = PrivateKey.fromStringDer(env.HEDERA_OPERATOR_KEY);

  client = Client.forTestnet().setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(20));

  return client;
}

export function resetHederaClient(): void {
  client = null;
}
