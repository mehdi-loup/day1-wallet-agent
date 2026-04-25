'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function WalletMenuDropdown({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
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

/** Renders the connected wallet chip if a wallet is available; renders nothing otherwise. */
export function WalletMenu() {
  const { authenticated, logout } = usePrivy();
  const { wallets } = useWallets();

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
  const address = embeddedWallet?.address ?? wallets[0]?.address;

  if (!authenticated || !address) return null;

  return <WalletMenuDropdown address={address} onDisconnect={logout} />;
}
