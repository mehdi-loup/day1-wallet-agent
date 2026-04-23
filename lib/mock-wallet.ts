export interface RawHolding {
  symbol: string;
  balance: number;
  usd: number;
  chain: string;
}

export interface RawWalletData {
  address: string;
  holdings: RawHolding[];
  fetchedAt: string;
}

const MOCK_PORTFOLIOS: Record<string, RawHolding[]> = {
  default: [
    { symbol: 'ETH',  balance: 4.2,      usd: 13440,  chain: 'ethereum' },
    { symbol: 'USDC', balance: 5200,     usd: 5200,   chain: 'ethereum' },
    { symbol: 'ARB',  balance: 12000,    usd: 1560,   chain: 'arbitrum' },
    { symbol: 'WBTC', balance: 0.05,     usd: 3150,   chain: 'ethereum' },
    { symbol: 'OP',   balance: 3400,     usd: 918,    chain: 'optimism' },
  ],
};

export function getMockWalletData(address: string): RawWalletData {
  const holdings = MOCK_PORTFOLIOS[address.toLowerCase()] ?? MOCK_PORTFOLIOS.default;
  return {
    address,
    holdings,
    fetchedAt: new Date().toISOString(),
  };
}
