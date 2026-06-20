     1|# 🛡️ Hedera Spend Guardian
     2|
     3|**Policy-enforced AI agent for Hedera Testnet — 5 custom policies guard every transaction**
     4|
     5|[![Live Demo](https://img.shields.io/badge/Demo-Live-green)](https://hederapayments.vercel.app)
     6|[![Hedera AI Bounty](https://img.shields.io/badge/Hedera_AI_Bounty-Week_5-purple)](https://ai-bounties.hedera.com)
     7|[![Framework](https://img.shields.io/badge/Framework-Next.js_16-black)](https://nextjs.org)
     8|[![HAK](https://img.shields.io/badge/Hedera_Agent_Kit-v4.0.0-blue)](https://github.com/hashgraph/hedera-agent-kit-js)
     9|
    10|---
    11|
    12|## 📖 Overview
    13|
    14|Hedera Spend Guardian is an autonomous AI agent that leverages the **Hedera Agent Kit v4** with **LangChain/LangGraph** and **DeepSeek V4 Pro** to interact with Hedera Testnet. Every tool call—whether an on-chain transfer or an off-chain API request—is intercepted by a **5-layer policy engine** before execution.
    15|
    16|### Core Architecture
    17|
    18|```
    19|User Message → /api/chat
    20|  → Policy Engine (5 Custom Policies)
    21|    ├─ SpendLimitPolicy    → Daily HBAR cap + per-transaction limit
    22|    ├─ ServiceAllowPolicy  → Whitelist external APIs (Tavily, OpenAI, Hedera)
    23|    ├─ TimeWindowPolicy    → Business hours only (9:00–23:00 UTC)
    24|    ├─ MaxSpendPolicy      → USD-based daily budget + per-project caps
    25|    └─ AllowlistPolicy     → Counterparty guard + API provider filtering
    26|  → Pre-Execution Gate (wrapped-tools.ts)
    27|  → HAK v4 + LangChain Agent (6 tools)
    28|  → Hooks: AuditLogHook (HCS) + AlertHook (Telegram)
    29|  → DeepSeek LLM response
    30|```
    31|
    32|### Policies Implemented
    33|
    34|5 composable policies run in sequence — the first block wins:
    35|
    36|| Policy | Type | Enforcement |
    37||--------|------|-------------|
    38|| **SpendLimitPolicy** | Financial safety | Caps daily spend (default: 5 HBAR) + per-tx limit (default: 2 HBAR) |
    39|| **ServiceAllowPolicy** | Off-chain guard | Whitelists which external services the agent can call |
    40|| **TimeWindowPolicy** | Temporal guard | Restricts transactions to business hours (9:00–23:00 UTC), queries exempt |
    41|| **MaxSpendPolicy** | USD-based budgeting | Global + per-project daily USD caps with HBAR→USD conversion |
    42|| **AllowlistPolicy** | Counterparty guard | Blocks transfers to unauthorized accounts + unapproved API providers |
    43|
    44|All policies are **composable** — they run in sequence via `policyEngine.evaluate()`, and the first block wins. The pre-execution gate in `wrapped-tools.ts` prevents any transaction from reaching the network before all 5 policies pass.
    45|
    46|---
    47|
    48|## 🚀 Quick Start
    49|
    50|```bash
    51|# Clone
    52|https://github.com/374group-tech/hederapayments.git && cd hederapayments
    53|
    54|# Install
    55|npm install
    56|
    57|# Configure
    58|cp .env.example .env
    59|# Edit .env with your Hedera testnet credentials + DeepSeek API key
    60|
    61|# Run
    62|npm run dev
    63|```
    64|
    65|Open [http://localhost:3000](http://localhost:3000)
    66|
    67|---
    68|
    69|## ⚙️ Environment Variables
    70|
    71|```env
    72|# Hedera Testnet (ED25519 account)
    73|HEDERA_OPERATOR_ID=0.0.9253164
    74|HEDERA_OPERATOR_KEY=302e...
    75|
    76|# DeepSeek API (free tier at platform.deepseek.com)
    77|DEEPSEEK_API_KEY=sk-...
    78|
    79|# Policy configuration (optional — defaults shown)
    80|DAILY_SPEND_LIMIT_HBAR=5
    81|MAX_PER_TX_HBAR=2
    82|BUSINESS_START_HOUR=9
    83|BUSINESS_END_HOUR=23
    84|ALLOWED_SERVICES=tavily,openai,hedera
    85|TAVILY_API_KEY=tvly-...
    86|```
    87|
    88|---
    89|
    90|## 🧩 Tech Stack
    91|
    92|| Layer | Technology | Purpose |
    93||-------|-----------|---------|
    94|| **Framework** | Next.js 16 (App Router) | Full-stack React app |
    95|| **Language** | TypeScript | Type-safe agent code |
    96|| **Hedera SDK** | @hiero-ledger/sdk v2.85 | ED25519 signing + HCS |
    97|| **Agent Kit** | @hashgraph/hedera-agent-kit ^4.0.0 | Hedera tools for agent |
    98|| **LangChain** | @hashgraph/hedera-agent-kit-langchain ^1.0.0 + LangGraph | Agent orchestration |
    99|| **LLM** | DeepSeek V4 Pro (via Pioneer.ai) | Cost-optimized reasoning + direct SDK for transfers |
   100|| **UI** | React 19 + Tailwind CSS 4 | Chat panel + policy dashboard |
   101|| **Hosting** | Vercel | Production deployment |
   102|
   103|---
   104|
   105|## 📊 Live Demo
   106|
   107|**🔗 [hederapayments.vercel.app](https://hederapayments.vercel.app)**
   108|
   109|The app features:
   110|- **💬 Chat Panel** — Send requests to the policy-guarded agent
   111|- **📊 Policy Status Sidebar** — Real-time spend tracking, service whitelist, and time window status
   112|- **📜 HCS Audit Trail** — Every agent action logged to Hedera Consensus Service (topic ID visible in sidebar)
   113|- **🎨 Dark Theme** — Clean, modern UI built with Tailwind CSS
   114|
   115|---
   116|
   117|## 🔐 Safety & Autonomy
   118|
The agent signs transactions autonomously using ED25519 private key stored server-side. However, LLM-based function calling is unreliable for financial transactions — DeepSeek often outputs tool calls as text rather than executing them natively. Our architecture solves this with a **hybrid model**:

| Operation | Execution Model | Why |
|-----------|----------------|-----|
| **Transfers** (`transfer_hbar`) | **Direct Hedera SDK** | 100% reliable, zero hallucination, HashScan-verified |
| **Balance queries** | **Direct Hedera SDK** | Instant, zero LLM cost, no tool call overhead |
| **Account info** | **Direct Hedera SDK** | Deterministic, always accurate |
| **Free-form chat** | **DeepSeek V4 Pro Agent** | Flexible reasoning, full LangChain/LangGraph pipeline |

The policy engine evaluates ALL transfers BEFORE direct SDK execution — the pre-execution gate intercepts the parsed intent (amount + recipient), runs all 5 policies, and only allows the SDK transaction if every policy passes. This is a **stronger safety guarantee** than relying on LLM tool calls that may hallucinate or silently fail.
   120|
   121|- ✅ **No HashPack popups** — agent signs directly via `@hiero-ledger/sdk`
   122|- ✅ **5-layer policy defense** — every transaction passes through SpendLimit → ServiceAllow → TimeWindow → MaxSpend → Allowlist before execution
   123|- ✅ **Immutable audit trail** — every decision logged to HCS for full traceability
   124|- ✅ **Testnet only** — funds are HBAR testnet, no real value at risk
   125|
   126|---
   127|
   128|## 🧪 Agent Interaction Example
   129|
   130|```typescript
   131|// POST /api/chat — { "message": "Transfer 1 HBAR to 0.0.12345" }
   132|
   133|// Agent flow:
// 1. PolicyEngine.evaluate() checks all 5 policies
// 2. SpendLimitPolicy: 1 HBAR ≤ 2 HBAR per-tx → ✅
// 3. ServiceAllowPolicy: "hedera" is allowed → ✅
// 4. TimeWindowPolicy: 14:00 UTC is within 9-23 → ✅
// 5. MaxSpendPolicy: 1 × $0.07 = $0.07 < $50 → ✅
// 6. AllowlistPolicy: recipient in allowlist → ✅
// 7. Transaction signed with ED25519 key, submitted to testnet
// 8. HCS audit log written
// 9. Response returned with policy status + HashScan link
   142|
   143|// Response:
   144|{
   145|  "message": "Successfully transferred 1 HBAR to 0.0.12345. Tx: 0.0.9253164@...",
   146|  "blocked": false,
   147|  "policyResults": [
   148|    { "allowed": true, "policy": "SpendLimitPolicy" },
   149|    { "allowed": true, "policy": "ServiceAllowPolicy" },
   150|    { "allowed": true, "policy": "TimeWindowPolicy" },
   151|    { "allowed": true, "policy": "MaxSpendPolicy" },
   152|    { "allowed": true, "policy": "AllowlistPolicy" }
   153|  ],
   154|  "status": {
   155|    "spendLimit": { "spentToday": 1, "dailyLimit": 5, "perTxLimit": 2 },
   156|    "serviceAllow": { "allowedServices": ["tavily", "openai", "hedera"] },
   157|    "timeWindow": { "startHour": 9, "endHour": 23 },
   158|    "maxSpend": { "spentTodayUsd": 0.07, "dailyLimitUsd": 500, "remainingUsd": 499.93 },
   159|    "allowlist": { "apiProviders": ["openai", "tavily"], "accountIds": ["0.0.12345"] }
   160|  },
   161|  "topicId": "0.0.5XXXXXX"
   162|}
   163|```
   164|
   165|---
   166|
   167|## 📁 Project Structure
   168|
   169|```
   170|hederapayments/
   171|├── src/
   172|│   ├── app/
   173|│   │   ├── api/chat/route.ts      # POST /api/chat — agent endpoint
   174|│   │   ├── layout.tsx              # Root layout
   175|│   │   └── page.tsx                # Chat panel + policy dashboard
   176|│   └── lib/
   177|│       ├── config.ts               # Zod env validation
   178|│       ├── hedera-client.ts        # Client.forTestnet() with ED25519
   179|│       ├── hcs-audit.ts            # HCS topic + message submission
   180|│       ├── constants.ts            # Operator ID export
   181|│       ├── wrapped-tools.ts        # Pre-execution policy gate (wrap HAK tools)
   182|│       ├── policy-engine.ts        # Orchestrates all policies
   183|│       ├── hooks/
   184|│       │   ├── index.ts            # Hook exports
   185|│       │   ├── AlertHook.ts        # Telegram alerts on blocks/high-value tx
   186|│       │   └── AuditLogHook.ts     # HCS immutable audit trail (v2.0)
   187|│       └── policies/
   188|│           ├── types.ts            # PolicyResult + PolicyContext
   189|│           ├── spend-limit.ts      # SpendLimitPolicy (v1.0)
   190|│           ├── service-allow.ts    # ServiceAllowPolicy (v1.0)
   191|│           ├── time-window.ts      # TimeWindowPolicy (v1.0)
   192|│           ├── max-spend.ts        # MaxSpendPolicy (v2.0 — USD-based)
   193|│           └── allowlist.ts        # AllowlistPolicy (v2.0 — counterparty)
   194|├── package.json
   195|├── tsconfig.json
   196|├── .env.example
   197|└── README.md
   198|```
   199|
   200|---
   201|
   202|## 🐛 Known Issues & Workarounds
   203|
   204|### TypeScript build errors (TS1259/TS2749)
   205|`@hiero-ledger/sdk` transitive dependencies require:
   206|```json
   207|// tsconfig.json
   208|{
   209|  "compilerOptions": {
   210|    "esModuleInterop": true,
   211|    "allowSyntheticDefaultImports": true,
   212|    "target": "ES2017"
   213|  }
   214|}
   215|```
   216|
   217|### Tool type mismatch
   218|`toolkit.getTools()` returns `HederaAgentKitTool[]` — use `as any` cast for LangGraph compatibility.
   219|
   220|---
   221|
   222|## 👨‍💻 For Judges: 60-Second Test Guide
   223|
   224|| Step | Action | What to Verify |
   225||------|--------|----------------|
   226|| 1 | Open [hederapayments.vercel.app](https://hederapayments.vercel.app) | Dark-themed chat panel + policy sidebar loads with "5 custom policies" subtitle |
   227|| 2 | Type "Check my balance" and press Send | Agent responds via DeepSeek + HAK tools with real HBAR balance |
   228|| 3 | Observe Policy Status sidebar | All 5 policies show live configuration (SpendLimit, ServiceAllow, TimeWindow, MaxSpend, Allowlist) |
   229|| 4 | Type "Transfer 1 HBAR to 0.0.XXXXX" and send | Policy Engine evaluates all 5; response shows `blocked` or `success` with `policyResults` array |
   230|| 5 | Check response JSON in DevTools → Network → /api/chat | `policyResults` has 5 entries, `status` has all 5 policy statuses, `topicId` present |
   231|| 6 | Verify source: `src/lib/policies/` | 5 custom policy classes, composable in `policy-engine.ts`, guarded by `wrapped-tools.ts` |
   232|| 7 | Check `src/lib/hooks/` | AuditLogHook (HCS immutability) + AlertHook (Telegram notifications) — 643 lines |
   233|
   234|---
   235|
   236|## ✅ Bounty Checklist
   237|
   238|| Requirement | Status | Evidence |
   239||-------------|--------|----------|
   240|| Public GitHub repo | ✅ | [github.com/374group-tech/hederapayments](https://github.com/374group-tech/hederapayments) |
   241|| Uses Hedera Agent Kit | ✅ | HAK v4 + LangChain toolkit, 6 tools exposed |
   242|| 5 custom policies | ✅ | SpendLimit, ServiceAllow, TimeWindow, MaxSpend, Allowlist — composable engine ([source](https://github.com/374group-tech/hederapayments/tree/main/src/lib/policies)) |
   243|| Composable policy engine | ✅ | PolicyEngine evaluates all 5 in sequence ([source](https://github.com/374group-tech/hederapayments/blob/main/src/lib/policy-engine.ts)) |
   244|| Pre-execution gate | ✅ | wrapped-tools.ts — blocks BEFORE on-chain tx ([source](https://github.com/374group-tech/hederapayments/blob/main/src/lib/wrapped-tools.ts)) |
   245|| HCS Audit Trail | ✅ | AuditLogHook — immutable on-chain log via HCS ([source](https://github.com/374group-tech/hederapayments/blob/main/src/lib/hooks/AuditLogHook.ts)) |
   246|| Telegram Alerts | ✅ | AlertHook — real-time notifications on blocks/high-value/daily-limit ([source](https://github.com/374group-tech/hederapayments/blob/main/src/lib/hooks/AlertHook.ts)) |
   247|| Live demo (public URL) | ✅ | [hederapayments.vercel.app](https://hederapayments.vercel.app) |
   248|| GitHub feedback issue | ✅ | [Issue #933](https://github.com/hashgraph/hedera-agent-kit-js/issues/933) on hashgraph/hedera-agent-kit-js |
   249|| Human safety (no fund drain) | ✅ | 5-layer policy defense: spend caps + service whitelist + time window + USD budget + counterparty allowlist |
   250|| Agent autonomy | ✅ | ED25519 server-side signing, no HashPack popups needed |
   251|| README with architecture | ✅ | Architecture diagram + full tech stack above |
   252|| Iterative git history | ✅ | 29 commits across development window, all authored by 374group-tech |
   253|
   254|---
   255|
   256|## 🔗 On-Chain Verification
   257|
   258|Every agent action is verifiable on Hedera Testnet:
   259|
   260|- **HCS Audit Trail** — look up the `topicId` returned in every `/api/chat` response on [HashScan Testnet](https://hashscan.io/testnet/topic/). Every agent decision (allowed/blocked) is recorded immutably.
   261|- **Transfers** — if the agent executes a `transfer_hbar`, the transaction ID is returned in the response. Verify sender, recipient, and amount on HashScan.
   262|- **Account** — [0.0.9253164 on HashScan](https://hashscan.io/testnet/account/0.0.9253164) — ED25519 key, used for agent signing.
   263|
   264|---
   265|
   266|## 📜 License
   267|
   268|MIT — built for the Hedera AI Bounty Week 5 (Policy Agent).
   269|
   270|---
   271|
   272|*Built by [374group-tech](https://github.com/374group-tech) for the Hedera AI Bounty Campaign — June 2026*
   273|
   274|> 🔗 **YouTube description should include:**
   275|> ```
   276|> 🔗 Live Demo: https://hederapayments.vercel.app/
   277|> 📂 GitHub: https://github.com/374group-tech/hederapayments
   278|> 🏆 Built for Hedera AI Bounty Week 5 — Policy Agent
   279|> #Hedera #HBAR #AI #Web3 #AgenticCommerce
   280|> ```
   281|