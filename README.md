# 🛡️ Hedera Spend Guardian

**Policy-enforced AI agent for Hedera Testnet — 3 custom policies guard every transaction**

[![Live Demo](https://img.shields.io/badge/Demo-Live-green)](https://hederapayments.vercel.app)
[![Hedera AI Bounty](https://img.shields.io/badge/Hedera_AI_Bounty-Week_5-purple)](https://ai-bounties.hedera.com)
[![Framework](https://img.shields.io/badge/Framework-Next.js_16-black)](https://nextjs.org)
[![HAK](https://img.shields.io/badge/Hedera_Agent_Kit-v4.0.0-blue)](https://github.com/hashgraph/hedera-agent-kit-js)

---

## 📖 Overview

Hedera Spend Guardian is an autonomous AI agent that leverages the **Hedera Agent Kit v4** with **LangChain/LangGraph** and **DeepSeek** to interact with Hedera Testnet. Every tool call—whether an on-chain transfer or an off-chain API request—is intercepted by a **3-layer policy engine** before execution.

### Core Architecture

```
User Message → /api/chat
  → Policy Engine (3 v1.0 + 2 v2.0 Custom Policies)
    ├─ SpendLimitPolicy    → Daily HBAR cap + per-transaction limit
    ├─ ServiceAllowPolicy  → Whitelist external APIs (Tavily, OpenAI, Hedera)
    └─ TimeWindowPolicy    → Business hours only (9:00–18:00 UTC)
  → HAK v4 Agent Tools (6 tools exposed)
    ├─ get_hbar_balance   → Query Hedera testnet balance
    ├─ get_account_info   → Inspect any account
    ├─ transfer_hbar      → Transfer HBAR between accounts
    ├─ get_token_balance  → Query token balances (HTS)
    ├─ get_topic_info     → Read HCS topics
    └─ submit_topic_message → Write to HCS audit trail
  → HCS Audit Trail (immutable on-chain log)
  → DeepSeek LLM response
```

### Policies Implemented

**v1.0 (active in policy engine)**

| Policy | Type | Enforcement |
|--------|------|-------------|
| **SpendLimitPolicy** | Financial safety | Caps daily spend (default: 5 HBAR) + per-tx limit (default: 2 HBAR) |
| **ServiceAllowPolicy** | Off-chain guard | Whitelists which external services the agent can call |
| **TimeWindowPolicy** | Temporal guard | Restricts transactions to business hours (9:00–18:00 UTC) |

**v2.0 (HAK AbstractPolicy — plug into pipeline via `.use()`)**

| Policy | Type | Enforcement |
|--------|------|-------------|
| **MaxSpendPolicy** | USD-based budgeting | Global + per-project daily USD caps with HBAR→USD conversion |
| **AllowlistPolicy** | Counterparty guard | Blocks transfers to unauthorized accounts + unapproved API providers |

All policies are **composable** — they run in sequence, and the first block wins. Policies are evaluated via `policyEngine.evaluate()` before any agent action.

---

## 🚀 Quick Start

```bash
# Clone
https://github.com/374group-tech/hederapayments.git && cd hederapayments

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your Hedera testnet credentials + DeepSeek API key

# Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## ⚙️ Environment Variables

```env
# Hedera Testnet (ED25519 account)
HEDERA_OPERATOR_ID=0.0.9253164
HEDERA_OPERATOR_KEY=302e...

# DeepSeek API (free tier at platform.deepseek.com)
DEEPSEEK_API_KEY=sk-...

# Policy configuration (optional — defaults shown)
DAILY_SPEND_LIMIT_HBAR=5
MAX_PER_TX_HBAR=2
BUSINESS_START_HOUR=9
BUSINESS_END_HOUR=18
ALLOWED_SERVICES=tavily,openai,hedera
TAVILY_API_KEY=tvly-...
```

---

## 🧩 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Next.js 16 (App Router) | Full-stack React app |
| **Language** | TypeScript | Type-safe agent code |
| **Hedera SDK** | @hiero-ledger/sdk v2.85 | ED25519 signing + HCS |
| **Agent Kit** | @hashgraph/hedera-agent-kit ^4.0.0 | Hedera tools for agent |
| **LangChain** | @hashgraph/hedera-agent-kit-langchain ^1.0.0 + LangGraph | Agent orchestration |
| **LLM** | @langchain/deepseek (deepseek-chat) | Cost-optimized reasoning ($0.14/M tok) |
| **UI** | React 19 + Tailwind CSS 4 | Chat panel + policy dashboard |
| **Hosting** | Vercel | Production deployment |

---

## 📊 Live Demo

**🔗 [hederapayments.vercel.app](https://hederapayments.vercel.app)**

The app features:
- **💬 Chat Panel** — Send requests to the policy-guarded agent
- **📊 Policy Status Sidebar** — Real-time spend tracking, service whitelist, and time window status
- **📜 HCS Audit Trail** — Every agent action logged to Hedera Consensus Service (topic ID visible in sidebar)
- **🎨 Dark Theme** — Clean, modern UI built with Tailwind CSS

---

## 🔐 Safety & Autonomy

**The agent signs transactions autonomously** using the ED25519 private key stored server-side in `.env`. This demonstrates true agentic behavior — the policy layer IS the safety mechanism, replacing traditional human-in-the-loop approval.

- ✅ **No HashPack popups** — agent signs directly via `@hiero-ledger/sdk`
- ✅ **3-layer policy defense** — every transaction passes through SpendLimit → ServiceAllow → TimeWindow before execution
- ✅ **Immutable audit trail** — every decision logged to HCS for full traceability
- ✅ **Testnet only** — funds are HBAR testnet, no real value at risk

---

## 🧪 Agent Interaction Example

```typescript
// POST /api/chat — { "message": "Transfer 1 HBAR to 0.0.12345" }

// Agent flow:
// 1. PolicyEngine.evaluate() checks all 3 policies
// 2. SpendLimitPolicy: 1 HBAR ≤ 2 HBAR per-tx → ✅
// 3. ServiceAllowPolicy: "hedera" is allowed → ✅
// 4. TimeWindowPolicy: 14:00 UTC is within 9-18 → ✅
// 5. Agent invokes transfer_hbar tool via HAK v4
// 6. Transaction signed with ED25519 key, submitted to testnet
// 7. HCS audit log written
// 8. Response returned with policy status

// Response:
{
  "message": "Successfully transferred 1 HBAR to 0.0.12345. Tx: 0.0.9253164@...",
  "blocked": false,
  "policyResults": [
    { "allowed": true, "policy": "SpendLimitPolicy" },
    { "allowed": true, "policy": "ServiceAllowPolicy" },
    { "allowed": true, "policy": "TimeWindowPolicy" }
  ],
  "status": {
    "spendLimit": { "spentToday": 1, "dailyLimit": 5, "perTxLimit": 2 },
    "serviceAllow": { "allowedServices": ["tavily", "openai", "hedera"] },
    "timeWindow": { "startHour": 9, "endHour": 18 }
  },
  "topicId": "0.0.XXXXXXX"
}
```

---

## 📁 Project Structure

```
hederapayments/
├── src/
│   ├── app/
│   │   ├── api/chat/route.ts      # POST /api/chat — agent endpoint
│   │   ├── layout.tsx              # Root layout
│   │   └── page.tsx                # Chat panel + policy dashboard
│   └── lib/
│       ├── config.ts               # Zod env validation
│       ├── hedera-client.ts        # Client.forTestnet() with ED25519
│       ├── hcs-audit.ts            # HCS topic + message submission (legacy)
│       ├── constants.ts            # Operator ID export
│       ├── wrapped-tools.ts        # Pre-execution policy gate (wrap HAK tools)
│       ├── policy-engine.ts        # Orchestrates all policies
│       ├── hooks/
│       │   ├── index.ts            # Hook exports
│       │   ├── AlertHook.ts        # Telegram alerts on blocks/high-value tx
│       │   └── AuditLogHook.ts     # HCS immutable audit trail (v2.0)
│       └── policies/
│           ├── types.ts            # PolicyResult + PolicyContext
│           ├── spend-limit.ts      # SpendLimitPolicy (v1.0)
│           ├── service-allow.ts    # ServiceAllowPolicy (v1.0)
│           ├── time-window.ts      # TimeWindowPolicy (v1.0)
│           ├── max-spend.ts        # MaxSpendPolicy (v2.0 — USD-based)
│           └── allowlist.ts        # AllowlistPolicy (v2.0 — counterparty)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 🐛 Known Issues & Workarounds

### TypeScript build errors (TS1259/TS2749)
`@hiero-ledger/sdk` transitive dependencies require:
```json
// tsconfig.json
{
  "compilerOptions": {
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2017"
  }
}
```

### Tool type mismatch
`toolkit.getTools()` returns `HederaAgentKitTool[]` — use `as any` cast for LangGraph compatibility.

---

## 👨‍💻 For Judges: 60-Second Test Guide

| Step | Action | What to Verify |
|------|--------|----------------|
| 1 | Open [hederapayments.vercel.app](https://hederapayments.vercel.app) | Dark-themed chat panel + policy sidebar loads |
| 2 | Type "Check my balance" and press Send | Agent responds via DeepSeek + HAK tools |
| 3 | Observe Policy Status sidebar | All 5 policies show live configuration |
| 4 | Check response JSON in DevTools → Network → /api/chat | `policyResults` array shows policy evaluations |
| 5 | Note `topicId` in response | HCS audit trail topic created on-chain |
| 6 | Verify source: `src/lib/policies/` | 5 custom policy classes, composable in `policy-engine.ts` |

---

## ✅ Bounty Checklist

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Public GitHub repo | ✅ | [github.com/374group-tech/hederapayments](https://github.com/374group-tech/hederapayments) |
| Uses Hedera Agent Kit | ✅ | HAK v4 + LangChain toolkit, 6 tools exposed |
| 3+2 custom policies (v1.0 + v2.0) | ✅ | 3 composable (SpendLimit, ServiceAllow, TimeWindow) + 2 HAK AbstractPolicy (MaxSpend, Allowlist) ([source](https://github.com/374group-tech/hederapayments/tree/main/src/lib/policies)) |
| Composable policy engine | ✅ | PolicyEngine evaluates all policies in sequence ([source](https://github.com/374group-tech/hederapayments/blob/main/src/lib/policy-engine.ts)) |
| HCS Audit Trail | ✅ | Immutable on-chain log via `TopicMessageSubmitTransaction` ([source](https://github.com/374group-tech/hederapayments/blob/main/src/lib/hcs-audit.ts)) |
| Live demo (public URL) | ✅ | [hederapayments.vercel.app](https://hederapayments.vercel.app) |
| GitHub feedback issue | ✅ | [Issue #933](https://github.com/hashgraph/hedera-agent-kit-js/issues/933) on hashgraph/hedera-agent-kit-js |
| Human safety (no fund drain) | ✅ | 3-layer policy defense: spend caps + service whitelist + time window |
| Agent autonomy | ✅ | ED25519 server-side signing, no HashPack popups needed |
| README with architecture | ✅ | Architecture diagram + tech stack above |
| Iterative git history | ✅ | 10 commits across development window, all authored by 374group-tech |

---

## 🔗 On-Chain Verification

Every agent action is verifiable on Hedera Testnet:

- **HCS Audit Trail** — look up the `topicId` returned in every `/api/chat` response on [HashScan Testnet](https://hashscan.io/testnet/topic/). Every agent decision (allowed/blocked) is recorded immutably.
- **Transfers** — if the agent executes a `transfer_hbar`, the transaction ID is returned in the response. Verify sender, recipient, and amount on HashScan.
- **Account** — [0.0.9253164 on HashScan](https://hashscan.io/testnet/account/0.0.9253164) — ED25519 key, used for agent signing.

---

## 📜 License

MIT — built for the Hedera AI Bounty Week 5 (Policy Agent).

---

*Built by [374group-tech](https://github.com/374group-tech) for the Hedera AI Bounty Campaign — June 2026*

> 🔗 **YouTube description should include:**
> ```
> 🔗 Live Demo: https://hederapayments.vercel.app/
> 📂 GitHub: https://github.com/374group-tech/hederapayments
> 🏆 Built for Hedera AI Bounty Week 5 — Policy Agent
> #Hedera #HBAR #AI #Web3 #AgenticCommerce
> ```
