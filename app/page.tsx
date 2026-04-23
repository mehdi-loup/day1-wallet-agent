'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PortfolioSummary } from '@/lib/schemas/portfolio';

export default function Home() {
  const [address, setAddress] = useState('');
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPortfolio(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPortfolio(null);
    setLoading(true);
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
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      <header className="relative z-10 border-b border-gray-800/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="font-mono text-sm font-medium tracking-widest text-gray-300 uppercase">
            Wallet Agent
          </span>
        </div>
        <Link
          href="/chat"
          className="font-mono text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          skip to chat →
        </Link>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl space-y-10">

          <div className="space-y-3">
            <h1 className="font-mono text-4xl font-bold tracking-tight text-white leading-tight">
              Know your<br />
              <span className="text-blue-400">on-chain position.</span>
            </h1>
            <p className="font-mono text-sm text-gray-500 leading-relaxed">
              Paste an EVM wallet address. Get a structured summary<br />
              of your holdings and a risk assessment — instantly.
            </p>
          </div>

          <form onSubmit={fetchPortfolio} className="space-y-3">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              className="w-full bg-gray-900 border border-gray-700 hover:border-gray-600 focus:border-blue-500 rounded-lg px-4 py-3.5 font-mono text-sm text-gray-100 placeholder-gray-600 focus:outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={!address.trim() || loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg px-4 py-3 font-mono text-sm font-medium transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  Analyzing…
                </span>
              ) : (
                'Analyze wallet'
              )}
            </button>
          </form>

          {error && (
            <div className="rounded-lg bg-red-950/50 border border-red-800/50 px-4 py-3 font-mono text-sm text-red-400 flex gap-2">
              <span className="shrink-0">!</span>
              {error}
            </div>
          )}

          {portfolio && (
            <div className="rounded-xl border border-gray-700/60 bg-gray-900/40 overflow-hidden divide-y divide-gray-800/60">
              <div className="px-6 py-5 flex items-baseline justify-between">
                <span className="font-mono text-xs text-gray-500 uppercase tracking-widest">
                  Net worth
                </span>
                <span className="font-mono text-3xl font-bold tabular-nums">
                  ${portfolio.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="px-6 py-5">
                <p className="font-mono text-xs text-gray-500 uppercase tracking-widest mb-4">
                  Top holdings
                </p>
                <div className="space-y-3">
                  {portfolio.topHoldings.map((h) => {
                    const pct = (h.usd / portfolio.totalUsd) * 100;
                    return (
                      <div key={h.symbol} className="space-y-1.5">
                        <div className="flex items-center justify-between font-mono text-sm">
                          <span className="text-gray-300 font-medium">{h.symbol}</span>
                          <span className="tabular-nums text-gray-400">
                            ${h.usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="h-px bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="px-6 py-5">
                <p className="font-mono text-xs text-gray-500 uppercase tracking-widest mb-2">
                  Risk assessment
                </p>
                <p className="font-mono text-sm text-gray-300 leading-relaxed">
                  {portfolio.riskNotes}
                </p>
              </div>

              <div className="px-6 py-5 bg-gray-900/30">
                <Link href="/chat" className="group flex items-center justify-between w-full">
                  <div>
                    <p className="font-mono text-sm font-medium text-white group-hover:text-blue-400 transition-colors">
                      Dive in →
                    </p>
                    <p className="font-mono text-xs text-gray-500 mt-0.5">
                      Chat with your portfolio data
                    </p>
                  </div>
                  <div className="w-8 h-8 rounded-full border border-gray-700 group-hover:border-blue-500 group-hover:bg-blue-500/10 flex items-center justify-center transition-all">
                    <span className="text-gray-500 group-hover:text-blue-400 text-sm transition-colors">
                      →
                    </span>
                  </div>
                </Link>
              </div>
            </div>
          )}

          {!portfolio && !loading && (
            <p className="font-mono text-xs text-gray-600 text-center">
              or{' '}
              <Link
                href="/chat"
                className="text-gray-500 hover:text-gray-300 underline underline-offset-4 transition-colors"
              >
                jump straight to chat →
              </Link>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
