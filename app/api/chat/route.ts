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
- getWalletTokens: call this when the user provides a wallet address. Returns holdings with balanceUSD per token already included — do NOT follow up with getTokenPrice calls to value the portfolio.
- getTokenPrice: call this only for standalone price queries (e.g. "what's ETH at right now?").

Be concise and precise — your users are technical.`;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: { getTokenPrice, getWalletTokens },
      // OR semantics: any one condition firing stops the loop.
      // stepCountIs(6): hard ceiling — 6 gives room for getWalletTokens + a few
      //   price lookups + final synthesis without letting a confused model burn budget.
      // Custom predicate: guards the specific runaway where the model calls getTokenPrice
      //   repeatedly in a loop (e.g. re-fetching ETH on every step). 5 price calls in
      //   one turn is a symptom of a broken reasoning loop, not a valid user flow.
      stopWhen: [
        stepCountIs(6),
        ({ steps }) => {
          const priceCalls = steps
            .flatMap((s) => s.toolCalls ?? [])
            .filter((c) => c.toolName === 'getTokenPrice').length;
          return priceCalls >= 5;
        },
      ],
      // onStepFinish fires after each LLM call completes — this is the foundation
      // for Day 14's observability work (LangSmith / Langfuse). The structure here
      // maps directly to what those tools expect: step index, tool activity, finish
      // reason, and token usage per step.
      onStepFinish({ stepNumber, toolCalls, finishReason, usage }) {
        console.log(
          JSON.stringify({
            stepNumber,
            toolCallsCount: toolCalls?.length ?? 0,
            finishReason,
            usage,
          }),
        );
      },
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
