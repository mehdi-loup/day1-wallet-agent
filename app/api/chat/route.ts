import { streamText, UIMessage, convertToModelMessages, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { getTokenPrice } from '@/lib/tools/price';
import { searchCorpus } from '@/lib/tools/search-corpus';
import { zapperMCP } from '@/src/mastra/mcp';

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
 *
 * Day 10 delta: getWalletTokens (direct Zapper call) replaced by three MCP-backed
 * tools from the Day 9 server. The model picks the right granularity per query.
 * Lifecycle note: zapperMCP is a module-level singleton; listTools() reuses the
 * same child process across requests. In Next.js dev mode, hot reloads orphan the
 * old child process — harmless but worth knowing (see src/mastra/mcp.ts).
 */

const SYSTEM_PROMPT = `You are a DeFi portfolio analyst with two knowledge sources:

**Live on-chain data (Zapper tools)** — use for anything about a specific wallet:
- zapper-mcp_get_portfolio: full breakdown (tokens + DeFi positions + total USD). Default for "what's in this wallet?".
- zapper-mcp_get_token_balances: spot token holdings only. Use for "does this wallet hold X?" or chain-specific token questions.
- zapper-mcp_get_app_positions: DeFi protocol positions only (Aave debt, Uniswap LP, staking). Use for leverage, yield, or protocol questions.
- getTokenPrice: standalone price queries only (e.g. "what's ETH at?"). Do NOT call after a portfolio query — balanceUSD is already included.

**Corpus knowledge (searchCorpus)** — use for questions about Wayfinder Paths: named workflow paths, orchestration patterns, strategy definitions, or DeFi automation archetypes. Do NOT use for live wallet data or prices.

When you use searchCorpus results, attribute them: "According to the Wayfinder Paths corpus…". If the corpus has no relevant info, say so — do not fabricate a citation.

Be concise and precise — your users are technical.`;

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    // Fetch MCP tools once per request — the MCPClient singleton reuses the
    // underlying child process, so this is a cheap in-memory lookup after boot.
    const mcpTools = await zapperMCP.listTools();

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: { getTokenPrice, searchCorpus, ...mcpTools },
      // OR semantics: any one condition firing stops the loop.
      // stepCountIs(6): hard ceiling — 6 gives room for a portfolio query + a few
      //   follow-up tool calls + final synthesis without letting a confused model burn budget.
      stopWhen: [
        stepCountIs(6),
        ({ steps }) => {
          const priceCalls = steps
            .flatMap((s) => s.toolCalls ?? [])
            .filter((c) => c.toolName === 'getTokenPrice').length;
          return priceCalls >= 5;
        },
      ],
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
