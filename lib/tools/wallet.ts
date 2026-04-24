import { tool } from 'ai';
import { z } from 'zod';
import { getMockWalletData } from '../mock-wallet';

export const getWalletTokens = tool({
  description:
    'Get token balances for an Ethereum wallet address. Returns each token symbol, balance, and chain.',
  inputSchema: z.object({
    address: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid 0x Ethereum address')
      .describe('Ethereum wallet address starting with 0x'),
  }),
  execute: async ({ address }) => {
    const data = getMockWalletData(address);
    return {
      address: data.address,
      holdings: data.holdings.map((h) => ({
        symbol: h.symbol,
        balance: h.balance,
        chain: h.chain,
      })),
      fetchedAt: data.fetchedAt,
    };
  },
});
