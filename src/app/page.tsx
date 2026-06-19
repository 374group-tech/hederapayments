"use client";

import { useState } from "react";

export default function Home() {
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setResponse(null);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    setResponse(data);
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">🛡️ Hedera Spend Guardian</h1>
        <p className="text-gray-400 mb-8">
          Policy-enforced AI agent — 5 custom policies guard every transaction
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chat Panel */}
          <div className="lg:col-span-2 bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h2 className="text-xl font-semibold mb-4">💬 Agent Chat</h2>
            <div className="mb-4">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your request... e.g. 'Find latest Hedera news'"
                className="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 min-h-[100px]"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              />
            </div>
            <button
              onClick={send}
              disabled={loading}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-6 py-2 rounded-lg font-medium transition"
            >
              {loading ? "Sending..." : "Send"}
            </button>

            {response && (
              <div className={`mt-6 p-4 rounded-lg ${response.blocked ? "bg-red-900/50 border border-red-700" : "bg-green-900/30 border border-green-700"}`}>
                <div className="font-medium mb-2">{response.blocked ? "❌ Blocked" : "✅ Allowed"}</div>
                <p className="text-sm text-gray-300">{response.message}</p>
                {response.reasons && (
                  <ul className="mt-2 text-sm text-red-400">
                    {response.reasons.map((r: string, i: number) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Policy Dashboard */}
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h2 className="text-xl font-semibold mb-4">📊 Policy Status</h2>
            {response?.status ? (
              <div className="space-y-4 text-sm">
                <div>
                  <div className="text-gray-400 mb-1">SpendLimitPolicy</div>
                  <div className="text-purple-400">
                    Daily: {response.status.spendLimit.spentToday} / {response.status.spendLimit.dailyLimit} HBAR
                  </div>
                  <div className="text-purple-400">
                    Per-tx max: {response.status.spendLimit.perTxLimit} HBAR
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">ServiceAllowPolicy</div>
                  <div className="text-green-400">
                    {(response.status.serviceAllow.allowedServices || []).join(", ")}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 mb-1">TimeWindowPolicy</div>
                  <div className="text-blue-400">
                    {response.status.timeWindow.startHour}:00–{response.status.timeWindow.endHour}:00 UTC
                  </div>
                </div>
                {response.status.maxSpend && (
                  <div>
                    <div className="text-gray-400 mb-1">MaxSpendPolicy</div>
                    <div className="text-orange-400">
                      Daily: ${response.status.maxSpend.spentTodayUsd.toFixed(2)} / ${response.status.maxSpend.dailyLimitUsd.toFixed(2)} USD
                    </div>
                    <div className="text-orange-400">
                      Remaining: ${response.status.maxSpend.remainingUsd.toFixed(2)}
                    </div>
                  </div>
                )}
                {response.status.allowlist && (
                  <div>
                    <div className="text-gray-400 mb-1">AllowlistPolicy</div>
                    <div className="text-yellow-400">
                      Providers: {(response.status.allowlist.apiProviders || []).join(", ")}
                    </div>
                    <div className="text-yellow-400 text-xs">
                      Accounts: {(response.status.allowlist.accountIds || ["none"]).join(", ")}
                    </div>
                  </div>
                )}
                {response.topicId && (
                  <div>
                    <div className="text-gray-400 mb-1">📜 HCS Audit</div>
                    <div className="text-yellow-400 text-xs font-mono">{response.topicId}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-500 text-sm">
                Send a message to see policy status...
              </div>
            )}

            {response?.policyResults && (
              <div className="mt-6 space-y-2">
                {response.policyResults.map((p: any, i: number) => (
                  <div key={i} className={`flex items-center gap-2 text-xs ${p.allowed ? "text-green-400" : "text-red-400"}`}>
                    <span>{p.allowed ? "✓" : "✗"}</span>
                    <span>{p.policy}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
