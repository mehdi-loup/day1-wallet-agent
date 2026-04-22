'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMemo, useRef, useState } from 'react';

export default function Chat() {
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [input, setInput] = useState('');

  // Ref so the transport closure always reads the latest provider without recreating
  const providerRef = useRef(provider);
  providerRef.current = provider;

  // Transport is stable for the chat session lifetime; body fn is called per-request
  const transport = useMemo(
    () => new DefaultChatTransport({ body: () => ({ provider: providerRef.current }) }),
    [],
  );

  const { messages, sendMessage, status } = useChat({ transport });

  const isStreaming = status === 'streaming';

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Wallet Agent</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Provider:</span>
          <button
            onClick={() => setProvider('anthropic')}
            className={`px-3 py-1 rounded-full transition-colors ${
              provider === 'anthropic'
                ? 'bg-orange-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Anthropic
          </button>
          <button
            onClick={() => setProvider('openai')}
            className={`px-3 py-1 rounded-full transition-colors ${
              provider === 'openai'
                ? 'bg-green-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            OpenAI
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-4 max-w-3xl mx-auto w-full">
        {messages.length === 0 && (
          <p className="text-gray-500 text-sm text-center mt-20">
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
