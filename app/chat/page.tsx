'use client';

import { useChat } from '@ai-sdk/react';
import { isToolUIPart, getToolName } from 'ai';
import { useState } from 'react';
import Link from 'next/link';
import { WalletMenu } from '@/app/components/WalletMenu';

// MAX_STEPS must match the stepCountIs ceiling in /api/chat/route.ts.
// Keeping this in sync manually is intentional — Day 14 will derive it from
// a shared constant once we have a config layer.
const MAX_STEPS = 6;

type ToolPart = Parameters<typeof getToolName>[0];

function ToolCard({ part }: { part: ToolPart }) {
  const name = getToolName(part);
  const state = (part as { state: string }).state;
  const input = (part as { input?: unknown }).input;
  const output = state === 'output-available' ? (part as { output: unknown }).output : null;
  const error = state === 'output-error' ? (part as unknown as { errorText: unknown }).errorText : null;

  const isInputStreaming = state === 'input-streaming';
  const isInputAvailable = state === 'input-available';
  const isPending = isInputStreaming || isInputAvailable;
  const isSuccess = state === 'output-available';
  const isError = state === 'output-error';

  return (
    <div
      className={`max-w-[80%] rounded-xl border font-mono text-xs transition-colors ${
        isSuccess
          ? 'border-emerald-800/60 bg-emerald-950/30'
          : isError
          ? 'border-red-800/60 bg-red-950/30'
          : 'border-gray-700/60 bg-gray-900/60'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2 text-gray-400">
        {isInputStreaming && (
          <span className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
        )}
        {isInputAvailable && (
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" />
        )}
        {isSuccess && (
          <span className="text-emerald-400 shrink-0">✓</span>
        )}
        {isError && (
          <span className="text-red-400 shrink-0">✗</span>
        )}

        <span className={isSuccess ? 'text-emerald-300' : isError ? 'text-red-300' : 'text-gray-300'}>
          {name}
        </span>

        <span className="text-gray-600 text-[10px]">
          {isInputStreaming && 'preparing call…'}
          {isInputAvailable && 'awaiting result…'}
          {isSuccess && 'done'}
          {isError && 'error'}
        </span>
      </div>

      {/* Args — show once input is available (not while still streaming in) */}
      {!isInputStreaming && input != null && (
        <div className="px-3 pb-2 text-gray-500 text-[10px] leading-relaxed break-all">
          <span className="text-gray-600">in </span>
          {JSON.stringify(input)}
        </div>
      )}

      {/* Result */}
      {isSuccess && output != null && (
        <div className="px-3 pb-2 text-emerald-400 text-[10px] leading-relaxed break-all">
          <span className="text-emerald-700">out </span>
          {JSON.stringify(output)}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="px-3 pb-2 text-red-400 text-[10px]">
          <span className="text-red-700">err </span>
          {String(error)}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, stop, status, error } = useChat();
  const isStreaming = status === 'streaming';

  // Derive step budget from the last assistant message's tool parts.
  // Each tool call that has moved past input-streaming = one completed step.
  // This intentionally reads message parts, not external state.
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const toolParts = lastAssistant?.parts.filter(isToolUIPart) ?? [];
  const completedSteps = toolParts.filter(
    (p) => (p as { state: string }).state !== 'input-streaming',
  ).length;
  const currentStep = isStreaming ? completedSteps + 1 : completedSteps;
  const showBudget = isStreaming && toolParts.length > 0;

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
        <div className="flex items-center gap-3">
          <WalletMenu />
          {/* Step budget chip — only visible during multi-step streaming */}
          {showBudget && (
            <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-full px-2.5 py-1">
              <span className="font-mono text-[10px] text-gray-400 tabular-nums">
                Step {currentStep} / {MAX_STEPS}
              </span>
              <div className="flex gap-0.5">
                {Array.from({ length: MAX_STEPS }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-1 h-1 rounded-full ${
                      i < currentStep ? 'bg-blue-400' : 'bg-gray-700'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

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
            className={`flex flex-col gap-2 ${message.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            {message.parts.map((part, i) => {
              if (part.type === 'text') {
                return (
                  <div
                    key={i}
                    className={`max-w-[80%] rounded-2xl px-4 py-3 font-mono text-sm leading-relaxed ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800/80 border border-gray-700/50 text-gray-100'
                    }`}
                  >
                    {part.text}
                  </div>
                );
              }

              if (isToolUIPart(part)) {
                return <ToolCard key={i} part={part} />;
              }

              return null;
            })}
          </div>
        ))}

        {/* Typing indicator — only shown when streaming but no tool cards are visible yet */}
        {isStreaming && toolParts.length === 0 && (
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
        <div className="flex gap-3 max-w-3xl mx-auto">
          <form
            className="flex flex-1 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || isStreaming) return;
              sendMessage({ text: input });
              setInput('');
            }}
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

          {/* Abort button — visible only while streaming. stop() cancels the client-side
              stream and signals an AbortSignal to the server. The AI SDK propagates this
              to the model stream itself, but in-flight tool fetches (e.g. CoinGecko HTTP
              requests) run to completion because Node.js fetch doesn't auto-cancel on
              request abort unless you thread the AbortSignal through manually. */}
          {isStreaming && (
            <button
              type="button"
              onClick={stop}
              className="px-4 py-3 rounded-lg font-mono text-sm font-medium border border-red-800/60 text-red-400 hover:bg-red-950/40 transition-colors"
            >
              Stop
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
