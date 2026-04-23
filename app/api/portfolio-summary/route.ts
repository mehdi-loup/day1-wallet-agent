// TODO: Day 2 — replace this comment with your own 3-sentence explanation (checkpoint #3)

import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { PortfolioSummarySchema } from '@/lib/schemas/portfolio';
import { getMockWalletData } from '@/lib/mock-wallet';

const RequestSchema = z.object({
  walletAddress: z
    .string()
    .refine((val) => /^0x[0-9a-fA-F]{40}$/.test(val), {
      message: 'Must be a valid 0x-prefixed Ethereum address (42 chars)',
    }),
});

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
  const walletData = getMockWalletData(walletAddress);

  try {
    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5-20251001'),
      schema: PortfolioSummarySchema,
      prompt: `You are a crypto portfolio analyst. Given the following wallet data, produce a structured summary.

Wallet address: ${walletData.address}
Holdings:
${walletData.holdings.map((h) => `- ${h.symbol}: ${h.balance} tokens = $${h.usd} USD (chain: ${h.chain})`).join('\n')}
Fetched at: ${walletData.fetchedAt}

Instructions:
- Set walletAddress to the exact address provided
- Calculate totalUsd as the sum of all USD values
- topHoldings: pick the top holdings by USD value (max 5), sorted descending
- riskNotes: write 1–3 sentences assessing concentration risk, stablecoin ratio, or chain diversification
- generatedAt: use the fetchedAt timestamp exactly`,
    });

    return Response.json(object);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate portfolio summary';
    return Response.json({ error: message }, { status: 500 });
  }
}
