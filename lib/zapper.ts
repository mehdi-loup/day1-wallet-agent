export interface ZapperHolding {
  symbol: string;
  balance: number;
  balanceUSD: number | null;
}

export interface ZapperPortfolio {
  holdings: ZapperHolding[];
  source: 'zapper' | 'mock';
  fetchedAt: string;
}

const ENDPOINT = 'https://public.zapper.xyz/graphql';

const QUERY = `
  query PortfolioV2($addresses: [Address!]!, $networks: [Network!]) {
    portfolioV2(addresses: $addresses, networks: $networks) {
      tokenBalances {
        byToken {
          edges {
            node {
              balance
              balanceUSD
              symbol
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

export async function fetchZapperPortfolio(address: string): Promise<ZapperPortfolio | null> {
  const apiKey = process.env.ZAPPER_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zapper-api-key': apiKey,
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { addresses: [address], networks: NETWORKS },
      }),
    });

    if (!res.ok) return null;

    const json = await res.json() as {
      data?: {
        portfolioV2?: {
          tokenBalances?: {
            byToken?: {
              edges?: Array<{
                node: { balance: string; balanceUSD: number | null; symbol: string };
              }>;
            };
          };
        };
      };
    };

    const edges = json.data?.portfolioV2?.tokenBalances?.byToken?.edges ?? [];
    return {
      holdings: edges.map((e) => ({
        symbol: e.node.symbol,
        balance: parseFloat(e.node.balance),
        balanceUSD: e.node.balanceUSD ?? null,
      })),
      source: 'zapper',
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
