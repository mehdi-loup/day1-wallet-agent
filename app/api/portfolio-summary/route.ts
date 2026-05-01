// TODO: Day 2 — replace this comment with your own 3-sentence explanation (checkpoint #3)

import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { PortfolioSummarySchema } from '@/lib/schemas/portfolio';
import { getMockWalletData } from '@/lib/mock-wallet';
import { zapperMCP } from '@/src/mastra/mcp';

const RequestSchema = z.object({
  walletAddress: z
    .string()
    .refine((val) => /^0x[0-9a-fA-F]{40}$/.test(val), {
      message: 'Must be a valid 0x-prefixed Ethereum address (42 chars)',
    }),
});

// Shape returned by the Day 9 server's get_token_balances tool.
// The MCP execute returns { content: [{type:'text', text: jsonString}], isError? }
// unless the server returned structuredContent, which this server does not.
type MCPCallResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

type TokenBalance = {
  symbol: string;
  balance: number;
  balanceUSD: number;
};

type TokenBalancesResult = {
  totalUSD: number;
  tokens: TokenBalance[];
};

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { walletAddress } = parsed.data;

  // Fetch token balances via MCP — same data as before, but routed through
  // the Day 9 server. The agent no longer calls Zapper directly.
  const tools = await zapperMCP.listTools();
  const tokenBalancesTool = tools['zapper-mcp_get_token_balances'];

  let holdings: string[];
  let fetchedAt: string;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await tokenBalancesTool.execute?.({ address: walletAddress }, {} as any)) as MCPCallResult;

    if (raw?.isError || !raw?.content?.[0]?.text) {
      throw new Error(raw?.content?.[0]?.text ?? 'MCP tool returned no data');
    }

    const result = JSON.parse(raw.content[0].text) as TokenBalancesResult;
    holdings = result.tokens.map(
      (t) => `- ${t.symbol}: ${t.balance} tokens = $${t.balanceUSD} USD`,
    );
    fetchedAt = new Date().toISOString();
  } catch {
    // Fallback to mock if MCP call fails (server not running, bad key, etc.)
    const data = getMockWalletData(walletAddress);
    holdings = data.holdings.map(
      (h) => `- ${h.symbol}: ${h.balance} tokens = $${h.usd} USD (chain: ${h.chain})`,
    );
    fetchedAt = new Date().toISOString();
  }

  try {
    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5-20251001'),
      schema: PortfolioSummarySchema,
      prompt: `You are a crypto portfolio analyst. Given the following wallet data, produce a structured summary.

Wallet address: ${walletAddress}
Holdings:
${holdings.join('\n')}
Fetched at: ${fetchedAt}

Instructions:
- Set walletAddress to the exact address provided
- Calculate totalUsd as the sum of all USD values
- topHoldings: pick the top 5 holdings by USD value, sorted descending
- riskNotes: write 1–3 sentences assessing concentration risk, stablecoin ratio, or chain diversification
- generatedAt: use the fetchedAt timestamp exactly`,
    });

    return Response.json(object);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate portfolio summary';
    return Response.json({ error: message }, { status: 500 });
  }
}
