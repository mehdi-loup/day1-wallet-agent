import { tool } from 'ai';
import { z } from 'zod';

const SYMBOL_TO_ID: Record<string, string> = {
  BTC:   'bitcoin',
  ETH:   'ethereum',
  USDC:  'usd-coin',
  USDT:  'tether',
  ARB:   'arbitrum',
  OP:    'optimism',
  WBTC:  'wrapped-bitcoin',
  MATIC: 'matic-network',
  LINK:  'chainlink',
  UNI:   'uniswap',
};

export const getTokenPrice = tool({
  description:
    'Get the current USD price for a crypto token. Pass the token ticker symbol (e.g. ETH, BTC, USDC).',
  inputSchema: z.object({
    symbol: z
      .string()
      .toUpperCase()
      .describe('Token ticker symbol, e.g. "ETH" or "BTC"'),
  }),
  execute: async ({ symbol }) => {
    const id = SYMBOL_TO_ID[symbol];
    if (!id) {
      return { symbol, usd: null, error: `Unknown symbol: ${symbol}` };
    }

    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
        { next: { revalidate: 60 } },
      );
      if (!res.ok) {
        return { symbol, usd: null, error: `CoinGecko ${res.status}` };
      }
      const data = await res.json() as Record<string, { usd: number }>;
      const usd = data[id]?.usd ?? null;
      return { symbol, usd, fetchedAt: new Date().toISOString() };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'fetch failed';
      return { symbol, usd: null, error: message };
    }
  },
});
