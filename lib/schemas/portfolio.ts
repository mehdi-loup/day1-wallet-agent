import { z } from 'zod';

export const PortfolioSummarySchema = z.object({
  // z.string() + refine gives us runtime validation streamText+TS types never could
  walletAddress: z
    .string()
    .refine((val) => /^0x[0-9a-fA-F]{40}$/.test(val), {
      message: 'Must be a valid 0x-prefixed Ethereum address (42 chars)',
    }),

  // z.number() rejects strings — Claude can't sneak "1234.56" past us
  totalUsd: z.number().nonnegative(),

  // z.array().max(5) enforces the "top holdings" contract at runtime
  topHoldings: z
    .array(
      z.object({
        symbol: z.string(),
        balance: z.number().nonnegative(),
        usd: z.number().nonnegative(),
      }),
    )
    .max(5),

  // min/max on string length keeps Claude from going off-script
  riskNotes: z.string().min(10).max(500),

  // datetime() validates ISO 8601 format — a plain string() would accept "yesterday"
  generatedAt: z.string().datetime(),
});

export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;
