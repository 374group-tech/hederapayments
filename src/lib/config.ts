import { z } from "zod";

export const envSchema = z.object({
  HEDERA_OPERATOR_ID: z.string().min(1, "HEDERA_OPERATOR_ID is required"),
  HEDERA_OPERATOR_KEY: z.string().min(1, "HEDERA_OPERATOR_KEY is required"),
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
  TAVILY_API_KEY: z.string().optional(),
  DAILY_SPEND_LIMIT_HBAR: z.coerce.number().default(5),
  MAX_PER_TX_HBAR: z.coerce.number().default(2),
  BUSINESS_START_HOUR: z.coerce.number().default(9),
  BUSINESS_END_HOUR: z.coerce.number().default(18),
  ALLOWED_SERVICES: z.string().default("tavily,openai"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Missing or invalid environment variables");
}

export const env = parsed.data;
