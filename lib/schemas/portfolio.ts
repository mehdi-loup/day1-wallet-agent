import { z } from 'zod';

export const PortfolioSummarySchema = z.object({
  // z.string() + refine gives us runtime validation streamText+TS types never could
  walletAddress: z
    .string()
    .refine((val) => /^0x[0-9a-fA-F]{40}$/.test(val), {
      message: 'Must be a valid 0x-prefixed Ethereum address (42 chars)',
    }),

  // z.number() rejects strings — Claude can't sneak "1234.56" past us
  totalUsd: z.number(),

  topHoldings: z.array(
    z.object({
      symbol: z.string(),
      balance: z.number(),
      usd: z.number(),
    }),
  ),

  riskNotes: z.string(),

  // ISO 8601 enforced via prompt; Anthropic structured output doesn't support format keywords
  generatedAt: z.string(),
});

export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;
