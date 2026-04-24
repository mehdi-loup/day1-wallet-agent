import { tool } from 'ai';
import { z } from 'zod';
import { getMockWalletData } from '../mock-wallet';
import { fetchZapperPortfolio } from '../zapper';

export const getWalletTokens = tool({
  description:
    'Get token balances for a wallet address. Returns each token with its current USD value — no separate price lookup needed.',
  inputSchema: z.object({
    address: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid 0x Ethereum address')
      .describe('Ethereum wallet address starting with 0x'),
  }),
  execute: async ({ address }) => {
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
