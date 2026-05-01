import { createStep, createWorkflow } from '@mastra/core/workflows';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

const anthropicProvider = createAnthropic({ baseURL: 'https://api.anthropic.com/v1' });
import { z } from 'zod';
import { getMockWalletData } from '../../../lib/mock-wallet';
import { zapperMCP } from '../mcp';
import { PortfolioSummarySchema } from '../../../lib/schemas/portfolio';

// Delta vs raw AI SDK:
//   - Each step has explicit inputSchema + outputSchema — data contracts enforced at every boundary
//   - Steps compose with .then(); the output of step N is automatically the input of step N+1
//   - execute receives { inputData, mastra } — NOT the raw input directly (contrast with createTool)
//   - The workflow is deterministic: no LLM decides what runs next, you do
//   - Steps 1+2 are pure JS (no LLM); only step 3 calls an LLM
//   - Trade-off vs agent loop: less flexible (can't add steps at runtime), but fully inspectable
//     in Studio — you see exactly what each step received and returned

// ─── Shared schemas ────────────────────────────────────────────────────────

const holdingSchema = z.object({
  symbol: z.string(),
  balance: z.number(),
  balanceUSD: z.number().nullable(),
});

const holdingsSchema = z.object({
  address: z.string(),
  holdings: z.array(holdingSchema),
  source: z.enum(['zapper', 'mock']),
  fetchedAt: z.string(),
});

// ─── Step 1: validate & normalise the wallet address ───────────────────────

const parseWalletStep = createStep({
  id: 'parse-wallet',
  description: 'Validates the wallet address and passes it downstream',
  inputSchema: z.object({
    walletAddress: z.string(),
  }),
  outputSchema: z.object({
    address: z.string(),
  }),
  execute: async ({ inputData }) => {
    const addr = inputData.walletAddress.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      throw new Error(`Invalid Ethereum address: ${addr}`);
    }
    return { address: addr };
  },
});

// ─── Step 2: fetch token balances ──────────────────────────────────────────

const fetchTokensStep = createStep({
  id: 'fetch-tokens',
  description: 'Fetches token balances from Zapper (or falls back to mock)',
  inputSchema: z.object({
    address: z.string(),
  }),
  outputSchema: holdingsSchema,
  execute: async ({ inputData }) => {
    const { address } = inputData;

    try {
      const tools = await zapperMCP.listTools();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (await tools['zapper-mcp_get_token_balances'].execute?.({ address }, {} as any)) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };

      if (raw?.isError || !raw?.content?.[0]?.text) {
        throw new Error(raw?.content?.[0]?.text ?? 'MCP returned no data');
      }

      const result = JSON.parse(raw.content[0].text) as {
        totalUSD: number;
        tokens: Array<{ symbol: string; balance: number; balanceUSD: number }>;
      };

      return {
        address,
        holdings: result.tokens.map((t) => ({
          symbol: t.symbol,
          balance: t.balance,
          balanceUSD: t.balanceUSD,
        })),
        source: 'zapper' as const,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
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
    }
  },
});

// ─── Step 3: generate structured portfolio summary ─────────────────────────
// Uses generateObject directly (raw AI SDK) — shows that Mastra steps can call
// any async code, including raw AI SDK primitives. Mastra provides the shell;
// the AI SDK does the actual LLM call.

const summariseStep = createStep({
  id: 'summarise',
  description: 'Generates a Zod-typed portfolio summary via LLM structured output',
  inputSchema: holdingsSchema,
  outputSchema: PortfolioSummarySchema,
  execute: async ({ inputData }) => {
    const totalUsd = inputData.holdings.reduce(
      (sum, h) => sum + (h.balanceUSD ?? 0),
      0,
    );

    const { object } = await generateObject({
      model: anthropicProvider('claude-haiku-4-5-20251001'),
      schema: PortfolioSummarySchema,
      prompt: `Summarise this crypto portfolio.

Wallet: ${inputData.address}
Source: ${inputData.source}
Fetched: ${inputData.fetchedAt}
Total USD value: $${totalUsd.toFixed(2)}

Holdings:
${inputData.holdings
  .map((h) => `  ${h.symbol}: ${h.balance} tokens = $${(h.balanceUSD ?? 0).toFixed(2)}`)
  .join('\n')}

Return a portfolio summary. For riskNotes: comment on concentration, stablecoin ratio, and any single-asset exposure above 50%.
Use ISO 8601 for generatedAt.`,
    });

    return object;
  },
});

// ─── Workflow composition ──────────────────────────────────────────────────

export const portfolioWorkflow = createWorkflow({
  id: 'portfolio-workflow',
  inputSchema: z.object({
    walletAddress: z.string().describe('0x Ethereum wallet address'),
  }),
  outputSchema: PortfolioSummarySchema,
})
  .then(parseWalletStep)
  .then(fetchTokensStep)
  .then(summariseStep);

portfolioWorkflow.commit();
