import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      HEDERA_OPERATOR_ID: "0.0.0",
      HEDERA_OPERATOR_KEY: "302e020100300506032b6570042204200000000000000000000000000000000000000000000000000000000000000000",
      DEEPSEEK_API_KEY: "sk-test",
      ALLOWED_SERVICES: "tavily,openai,hedera",
      DAILY_SPEND_LIMIT_HBAR: "5",
      MAX_PER_TX_HBAR: "2",
      BUSINESS_START_HOUR: "9",
      BUSINESS_END_HOUR: "18",
    },
  },
});