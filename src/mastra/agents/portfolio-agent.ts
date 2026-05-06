import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getTokenPrice } from '../tools/price';
import { zapperMCP } from '../mcp';

// Delta vs raw AI SDK:
//   - Agent IS the config — registered once on the Mastra instance, reused across requests.
//     In raw AI SDK you rebuild { model, system, messages, tools } on every POST.
//   - createAnthropic({ baseURL }) instead of bare anthropic() import — guards against
//     ANTHROPIC_BASE_URL env var set without the required /v1 suffix.
//   - memory: new Memory() removes the need to manually pass messages[] on each call.
//     Pass threadId + resourceId and Mastra fetches/stores history automatically.
//
// Day 10 delta: Zapper tools now come from the Day 9 MCP server via MCPClient.listTools().
//   Tool names are namespaced: zapper-mcp_get_portfolio, zapper-mcp_get_token_balances,
//   zapper-mcp_get_app_positions. The agent no longer holds ZAPPER_API_KEY or calls
//   the Zapper API directly — all Zapper calls go through the child process.

const anthropicProvider = createAnthropic({
  baseURL: 'https://api.anthropic.com/v1',
});

// MCP tools are optional — if the server binary is absent (Docker build, Vercel) the
// agent still works with getTokenPrice only. Failures here are caught at request time
// in the chat route; this guards the module-level import from crashing next build.
const mcpTools = await zapperMCP.listTools().catch(() => ({}));

export const portfolioAgent = new Agent({
  id: 'portfolio-agent',
  name: 'Crypto Portfolio Agent',
  instructions: `You are a DeFi portfolio analyst with access to real-time Zapper data.

For wallet queries, choose the right tool based on the question:
- zapper-mcp_get_portfolio: full breakdown (tokens + DeFi positions + total USD). Use when the user wants a complete picture.
- zapper-mcp_get_token_balances: spot token holdings only. Use for "does this wallet hold X?" or token-specific questions.
- zapper-mcp_get_app_positions: DeFi protocol positions only (Aave, Uniswap LP, staking). Use for leverage, yield, or protocol-specific questions.
- getTokenPrice: standalone price queries only (e.g. "what's ETH at right now?"). Do NOT call this after a portfolio query — balanceUSD is already included.

Be concise and precise — your users are technical.

You have memory across turns. If the user already provided a wallet address, use it without asking again.`,
  model: anthropicProvider('claude-haiku-4-5-20251001'),
  tools: { getTokenPrice, ...mcpTools },
  memory: new Memory({
    options: { lastMessages: 20 },
  }),
});
