import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { getTokenPrice } from '../tools/price';
import { getWalletTokens } from '../tools/wallet';

// Delta vs raw AI SDK:
//   - In AI SDK you call streamText({ model, system, messages, tools }) on every request
//   - Here the agent IS the config object — registered once, reused across requests
//   - model uses Mastra's router string "provider/model-id" instead of anthropic('...')
//   - memory: new Memory() wires up conversation persistence automatically;
//     in AI SDK you manually passed the messages[] array on every POST
//   - Storage is inherited from the Mastra instance (configured in index.ts)

export const portfolioAgent = new Agent({
  id: 'portfolio-agent',
  name: 'Crypto Portfolio Agent',
  instructions: `You are a crypto portfolio assistant. You have two tools:
- getWalletTokens: call this when the user provides a wallet address. Returns holdings with balanceUSD per token — do NOT follow up with getTokenPrice calls to value the portfolio.
- getTokenPrice: call this only for standalone price queries (e.g. "what's ETH at right now?").

Be concise and precise — your users are technical.

Important: you have memory across turns. If the user already told you their wallet address in a previous message, use it — don't ask again.`,
  model: 'anthropic/claude-haiku-4-5-20251001',
  tools: { getTokenPrice, getWalletTokens },
  memory: new Memory({
    options: { lastMessages: 20 },
  }),
});
