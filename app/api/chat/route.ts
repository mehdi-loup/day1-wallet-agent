import { streamText, UIMessage, convertToModelMessages, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getTokenPrice } from '@/lib/tools/price';
import { getWalletTokens } from '@/lib/tools/wallet';

/*
 * TOOL CALLING — written by me after Day 3
 *
 * Tool calling lets the model decide at runtime to invoke a function, receive its
 * result, and continue reasoning — instead of making up data or relying on stale
 * system-prompt context.
 *
 * Multi-step execution works like this: user message → LLM call → model emits a
 * tool call → SDK executes it → result is injected back → another LLM call →
 * repeat until the model emits plain text or stopWhen fires.
 *
 * stopWhen: stepCountIs(N) caps how many LLM calls can happen per user turn.
 * Without it, a buggy prompt could loop indefinitely and burn API budget.
 *
 * One production failure mode: prompt injection — a malicious wallet token name
 * could instruct the model to call tools with attacker-chosen arguments.
 */

const SYSTEM_PROMPT = `You are a crypto portfolio assistant. You have two tools:
- getTokenPrice: call this when the user asks about the current price of a token
- getWalletTokens: call this when the user provides a wallet address and wants to see holdings

For portfolio value questions, call getWalletTokens first, then getTokenPrice for each token symbol in the result, then sum and reply. Be concise and precise — your users are technical.`;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: { getTokenPrice, getWalletTokens },
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
