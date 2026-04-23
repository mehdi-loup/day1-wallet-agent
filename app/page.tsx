'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import type { PortfolioSummary } from '@/lib/schemas/portfolio';

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function WalletMenu({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function copyAddress() {
    navigator.clipboard.writeText(address);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
        <span className="font-mono text-xs text-gray-300">{truncate(address)}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden shadow-xl z-50">
          <button
            onClick={copyAddress}
            className="w-full text-left px-4 py-3 font-mono text-xs text-gray-300 hover:bg-gray-800 transition-colors flex items-center gap-3"
          >
            <span className="text-gray-500">⎘</span> Copy address
          </button>
          <a
            href={`https://zapper.xyz/account/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="w-full text-left px-4 py-3 font-mono text-xs text-gray-300 hover:bg-gray-800 transition-colors flex items-center gap-3"
          >
            <span className="text-gray-500">↗</span> View in Zapper
          </a>
          <div className="border-t border-gray-800" />
          <button
            onClick={() => { onDisconnect(); setOpen(false); }}
            className="w-full text-left px-4 py-3 font-mono text-xs text-red-400 hover:bg-gray-800 transition-colors flex items-center gap-3"
          >
            <span className="text-gray-600">⏻</span> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
  const address = embeddedWallet?.address ?? wallets[0]?.address;

  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    setPortfolio(null);
    setError(null);
    setLoading(true);
    fetch('/api/portfolio-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: address }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error ?? 'Unknown error');
        setPortfolio(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [address]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      <header className="relative z-50 border-b border-gray-800/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="font-mono text-sm font-medium tracking-widest text-gray-300 uppercase">
            Wallet Agent
          </span>
        </div>
        {authenticated && address && (
          <WalletMenu address={address} onDisconnect={logout} />
        )}
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl space-y-10">

          {/* Loading Privy */}
          {!ready && (
            <div className="flex items-center justify-center gap-2 text-gray-600">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse" />
              <span className="font-mono text-xs">initializing…</span>
            </div>
          )}

          {/* Unauthenticated */}
          {ready && !authenticated && (
            <div className="space-y-8">
              <div className="space-y-3">
                <h1 className="font-mono text-4xl font-bold tracking-tight text-white leading-tight">
                  Know your<br />
                  <span className="text-blue-400">on-chain position.</span>
                </h1>
                <p className="font-mono text-sm text-gray-500 leading-relaxed">
                  Sign in with your social account. We&apos;ll create or recover
                  your embedded wallet automatically.
                </p>
              </div>

              <button
                onClick={login}
                className="w-full bg-blue-600 hover:bg-blue-500 rounded-lg px-4 py-3.5 font-mono text-sm font-medium transition-colors"
              >
                Connect wallet
              </button>

              <p className="font-mono text-xs text-gray-600 text-center">
                or{' '}
                <Link
                  href="/chat"
                  className="text-gray-500 hover:text-gray-300 underline underline-offset-4 transition-colors"
                >
                  jump straight to chat →
                </Link>
              </p>
            </div>
          )}

          {/* Authenticated */}
          {ready && authenticated && (
            <div className="space-y-6">

              {/* Portfolio loading */}
              {loading && (
                <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-6 py-10 flex items-center justify-center gap-2 text-gray-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse" />
                  <span className="font-mono text-xs">Analyzing portfolio…</span>
                </div>
              )}

              {/* Portfolio error */}
              {error && (
                <div className="rounded-lg bg-red-950/50 border border-red-800/50 px-4 py-3 font-mono text-sm text-red-400 flex gap-2">
                  <span className="shrink-0">!</span>
                  {error}
                </div>
              )}

              {/* Portfolio card */}
              {portfolio && (
                <div className="rounded-xl border border-gray-700/60 bg-gray-900/40 overflow-hidden divide-y divide-gray-800/60">
                  <div className="px-6 py-5 flex items-baseline justify-between">
                    <span className="font-mono text-xs text-gray-500 uppercase tracking-widest">Net worth</span>
                    <span className="font-mono text-3xl font-bold tabular-nums">
                      ${portfolio.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="px-6 py-5">
                    <p className="font-mono text-xs text-gray-500 uppercase tracking-widest mb-4">Top holdings</p>
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
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="px-6 py-5">
                    <p className="font-mono text-xs text-gray-500 uppercase tracking-widest mb-2">Risk assessment</p>
                    <p className="font-mono text-sm text-gray-300 leading-relaxed">{portfolio.riskNotes}</p>
                  </div>

                  <div className="px-6 py-5 bg-gray-900/30">
                    <Link href="/chat" className="group flex items-center justify-between w-full">
                      <div>
                        <p className="font-mono text-sm font-medium text-white group-hover:text-blue-400 transition-colors">
                          Dive in →
                        </p>
                        <p className="font-mono text-xs text-gray-500 mt-0.5">Chat with your portfolio data</p>
                      </div>
                      <div className="w-8 h-8 rounded-full border border-gray-700 group-hover:border-blue-500 group-hover:bg-blue-500/10 flex items-center justify-center transition-all">
                        <span className="text-gray-500 group-hover:text-blue-400 text-sm transition-colors">→</span>
                      </div>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
