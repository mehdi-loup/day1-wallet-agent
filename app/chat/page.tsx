'use client';

import { useChat } from '@ai-sdk/react';
import { useState } from 'react';
import Link from 'next/link';

export default function ChatPage() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, error } = useChat();
  const isStreaming = status === 'streaming';

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      <header className="relative z-10 border-b border-gray-800/60 px-6 py-4 flex items-center justify-between">
        <Link
          href="/"
          className="font-mono text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← Portfolio
        </Link>
        <div className="flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              isStreaming ? 'bg-blue-400 animate-pulse' : 'bg-gray-700'
            }`}
          />
          <span className="font-mono text-xs text-gray-500 uppercase tracking-widest">Chat</span>
        </div>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto px-6 py-6 max-w-3xl mx-auto w-full space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 space-y-2">
            <p className="font-mono text-sm text-gray-500 text-center leading-relaxed">
              Ask about your crypto portfolio,<br />wallet balances, or DeFi positions.
            </p>
            <p className="font-mono text-xs text-gray-700">
              ↑ analyze a wallet first for context
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 font-mono text-sm leading-relaxed ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800/80 border border-gray-700/50 text-gray-100'
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
            <div className="bg-gray-800/80 border border-gray-700/50 rounded-2xl px-4 py-3 flex gap-1 items-center">
              <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-xl px-4 py-3 font-mono text-sm bg-red-950/50 border border-red-800/50 text-red-400 flex gap-2">
              <span className="shrink-0">!</span>
              <p>{error.message || 'Something went wrong.'}</p>
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t border-gray-800/60 px-6 py-4">
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
            className="flex-1 bg-gray-900 border border-gray-700 hover:border-gray-600 focus:border-blue-500 rounded-lg px-4 py-3 font-mono text-sm placeholder-gray-600 focus:outline-none transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed px-5 py-3 rounded-lg font-mono text-sm font-medium transition-colors"
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
