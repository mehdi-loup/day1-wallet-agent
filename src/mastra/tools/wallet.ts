import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getMockWalletData } from '../../../lib/mock-wallet';
import { fetchZapperPortfolio } from '../../../lib/zapper';

const holdingSchema = z.object({
  symbol: z.string(),
  balance: z.number(),
  balanceUSD: z.number().nullable(),
});

export const getWalletTokens = createTool({
  id: 'get-wallet-tokens',
  description:
    'Get token balances for a wallet address. Returns each token with its current USD value — no separate price lookup needed.',
  inputSchema: z.object({
    address: z
      .string()
      .describe('Ethereum wallet address starting with 0x'),
  }),
  outputSchema: z.object({
    address: z.string(),
    holdings: z.array(holdingSchema),
    source: z.enum(['zapper', 'mock']),
    fetchedAt: z.string(),
  }),
  execute: async (inputData) => {
    const { address } = inputData;

    // Burn address — not a real wallet. Skip Zapper and return empty holdings.
    if (address.toLowerCase() === '0x0000000000000000000000000000000000000000') {
      return { address, holdings: [], source: 'mock' as const, fetchedAt: new Date().toISOString() };
    }

    const live = await fetchZapperPortfolio(address);

    if (live) {
      return { address, ...live };
    }

    const data = getMockWalletData(address);
    return {
      address: data.address,
      holdings: data.holdings.map((h) => ({
        symbol: h.symbol,
        balance: h.balance,
        balanceUSD: h.usd,
      })),
      source: 'mock' as const,
      fetchedAt: data.fetchedAt,
    };
  },
});
