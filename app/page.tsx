'use client';

import { useChat } from '@ai-sdk/react';
import { useState } from 'react';
import type { PortfolioSummary } from '@/lib/schemas/portfolio';

export default function Chat() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, error } = useChat();
  const isStreaming = status === 'streaming';

  const [address, setAddress] = useState('');
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  async function fetchPortfolio(e: React.FormEvent) {
    e.preventDefault();
    setPortfolioError(null);
    setPortfolio(null);
    setPortfolioLoading(true);
    try {
      const res = await fetch('/api/portfolio-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      setPortfolio(data);
    } catch (err) {
      setPortfolioError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setPortfolioLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Wallet Agent</h1>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-8 max-w-3xl mx-auto w-full">

        {/* Portfolio summary section */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Portfolio Summary</h2>
          <form onSubmit={fetchPortfolio} className="flex gap-3">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x… wallet address"
              className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <button
              type="submit"
              disabled={!address.trim() || portfolioLoading}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-3 rounded-xl text-sm font-medium transition-colors whitespace-nowrap"
            >
              {portfolioLoading ? 'Analyzing…' : 'Analyze'}
            </button>
          </form>

          {portfolioError && (
            <div className="rounded-xl bg-red-950 border border-red-800 text-red-300 px-4 py-3 text-sm flex gap-2">
              <span className="shrink-0">⚠</span>
              {portfolioError}
            </div>
          )}

          {portfolio && (
            <div className="rounded-xl bg-gray-800 border border-gray-700 overflow-hidden">
              {/* Total */}
              <div className="px-5 py-4 border-b border-gray-700 flex items-baseline justify-between">
                <span className="text-sm text-gray-400">Total value</span>
                <span className="text-2xl font-semibold tabular-nums">
                  ${portfolio.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {/* Top holdings */}
              <div className="px-5 py-4 border-b border-gray-700">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Top holdings</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs">
                      <th className="text-left pb-2 font-medium">Asset</th>
                      <th className="text-right pb-2 font-medium">Balance</th>
                      <th className="text-right pb-2 font-medium">USD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {portfolio.topHoldings.map((h) => (
                      <tr key={h.symbol}>
                        <td className="py-2 font-mono font-medium">{h.symbol}</td>
                        <td className="py-2 text-right tabular-nums text-gray-300">
                          {h.balance.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          ${h.usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Risk notes */}
              <div className="px-5 py-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Risk notes</p>
                <p className="text-sm text-gray-300 leading-relaxed">{portfolio.riskNotes}</p>
                <p className="text-xs text-gray-600 mt-3">
                  Generated {new Date(portfolio.generatedAt).toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Chat section */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Chat</h2>
          {messages.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-8">
              Ask about your crypto portfolio, wallet balances, or DeFi positions.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-100'
                }`}
              >
                {message.parts.map((part, i) =>
                  part.type === 'text' ? <span key={i}>{part.text}</span> : null,
                )}
              </div>
            </div>
          ))}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="bg-gray-800 rounded-2xl px-4 py-3 text-sm text-gray-400 animate-pulse">
                thinking…
              </div>
            </div>
          )}
          {error && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-red-950 border border-red-800 text-red-300 flex items-start gap-2">
                <span className="shrink-0">⚠</span>
                <p className="flex-1">{error.message || 'Something went wrong. Please try again.'}</p>
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-gray-800 px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim() || isStreaming) return;
            sendMessage({ text: input });
            setInput('');
          }}
          className="flex gap-3 max-w-3xl mx-auto"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your portfolio…"
            disabled={isStreaming}
            className="flex-1 bg-gray-800 rounded-xl px-4 py-3 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-3 rounded-xl text-sm font-medium transition-colors"
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
