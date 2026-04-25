import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Delta vs raw AI SDK tool():
//   - createTool requires an explicit `id` field (used in Studio UI and traces)
//   - createTool accepts an `outputSchema` — AI SDK tool() has no output validation
//   - execute receives inputData as a plain object (same as AI SDK, just not destructured here)

const SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDC: 'usd-coin',
  USDT: 'tether',
  ARB: 'arbitrum',
  OP: 'optimism',
  WBTC: 'wrapped-bitcoin',
  MATIC: 'matic-network',
  LINK: 'chainlink',
  UNI: 'uniswap',
};

export const getTokenPrice = createTool({
  id: 'get-token-price',
  description:
    'Get the current USD price for a crypto token. Pass the token ticker symbol (e.g. ETH, BTC, USDC).',
  inputSchema: z.object({
    symbol: z.string().describe('Token ticker symbol, e.g. "ETH" or "BTC"'),
  }),
  outputSchema: z.object({
    symbol: z.string(),
    usd: z.number().nullable(),
    fetchedAt: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const symbol = inputData.symbol.toUpperCase();
    const id = SYMBOL_TO_ID[symbol];
    if (!id) return { symbol, usd: null, error: `Unknown symbol: ${symbol}` };

    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      );
      if (!res.ok) return { symbol, usd: null, error: `CoinGecko ${res.status}` };
      const data = (await res.json()) as Record<string, { usd: number }>;
      return { symbol, usd: data[id]?.usd ?? null, fetchedAt: new Date().toISOString() };
    } catch (err) {
      return { symbol, usd: null, error: err instanceof Error ? err.message : 'fetch failed' };
    }
  },
});
