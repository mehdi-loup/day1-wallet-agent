import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { getTokenPrice } from '../tools/price';
import { getWalletTokens } from '../tools/wallet';

// Delta vs raw AI SDK:
//   - Agent IS the config — registered once on the Mastra instance, reused across requests.
//     In raw AI SDK you rebuild { model, system, messages, tools } on every POST.
//   - Provider swap pattern: same as Day 1 (env var → if/else), but here it's resolved
//     once at startup instead of per-request. The Agent object carries the chosen model.
//   - memory: new Memory() removes the need to manually pass messages[] on each call.
//     Just pass threadId + resourceId and Mastra fetches/stores history automatically.
//   - createAnthropic({ baseURL }) used instead of the bare anthropic() import to guard
//     against ANTHROPIC_BASE_URL being set without the required /v1 path suffix.

const anthropicProvider = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

const openaiProvider = createOpenAI();

function resolveModel() {
  const provider = process.env.AI_PROVIDER ?? 'anthropic';
  if (provider === 'openai') {
    return openaiProvider('gpt-4o-mini');
  }
  return anthropicProvider('claude-haiku-4-5-20251001');
}

export const portfolioAgent = new Agent({
  id: 'portfolio-agent',
  name: 'Crypto Portfolio Agent',
  instructions: `You are a crypto portfolio assistant. You have two tools:
- getWalletTokens: call this when the user provides a wallet address. Returns holdings with balanceUSD per token — do NOT follow up with getTokenPrice calls to value the portfolio.
- getTokenPrice: call this only for standalone price queries (e.g. "what's ETH at right now?").

Be concise and precise — your users are technical.

Important: you have memory across turns. If the user already told you their wallet address in a previous message, use it — don't ask again.`,
  model: resolveModel(),
  tools: { getTokenPrice, getWalletTokens },
  memory: new Memory({
    options: { lastMessages: 20 },
  }),
});
