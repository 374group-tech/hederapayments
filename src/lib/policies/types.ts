/**
 * Policy evaluation result.
 * - allowed: true => proceed
 * - allowed: false => blocked with reason
 */
export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  policy: string;
}

/**
 * Shared tracking context passed to every policy check.
 */
export interface PolicyContext {
  dailySpentHbar: number;
  currentTxHbar: number;
  serviceName?: string;
  toolName?: string;
  recipientId?: string;
  hour: number;
}
