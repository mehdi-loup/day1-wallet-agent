import { tool } from 'ai';
import { z } from 'zod';
import { getMockWalletData } from '../mock-wallet';

const ZAPPER_ENDPOINT = 'https://public.zapper.xyz/graphql';

const PORTFOLIO_QUERY = `
  query PortfolioV2($addresses: [Address!]!, $networks: [Network!]) {
    portfolioV2(addresses: $addresses, networks: $networks) {
      tokenBalances {
        byToken {
          edges {
            node {
              balance
              balanceUSD
              symbol
              name
            }
          }
        }
      }
    }
  }
`;

const NETWORKS = [
  'ETHEREUM_MAINNET',
  'ARBITRUM_MAINNET',
  'OPTIMISM_MAINNET',
  'POLYGON_MAINNET',
];

async function fetchFromZapper(address: string) {
  const apiKey = process.env.ZAPPER_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(ZAPPER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-zapper-api-key': apiKey,
    },
    body: JSON.stringify({
      query: PORTFOLIO_QUERY,
      variables: { addresses: [address], networks: NETWORKS },
    }),
  });

  if (!res.ok) return null;

  const json = await res.json() as {
    data?: {
      portfolioV2?: {
        tokenBalances?: {
          byToken?: {
            edges?: Array<{ node: { balance: string; balanceUSD: number | null; symbol: string; name: string } }>;
          };
        };
      };
    };
  };

  const edges = json.data?.portfolioV2?.tokenBalances?.byToken?.edges ?? [];
  return edges.map((e) => ({
    symbol: e.node.symbol,
    balance: parseFloat(e.node.balance),
    balanceUSD: e.node.balanceUSD ?? null,
  }));
}

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
    const live = await fetchFromZapper(address);

    if (live) {
      return {
        address,
        holdings: live,
        source: 'zapper' as const,
        fetchedAt: new Date().toISOString(),
      };
    }

    // Fall back to mock (no ZAPPER_API_KEY set)
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
