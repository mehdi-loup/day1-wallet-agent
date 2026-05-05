import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchDeduped } from 'day11-rag';

// Why searchDeduped and not search?
// search() returns raw chunks — multiple from the same document are common at k≥3.
// searchDeduped() keeps only the top-scoring chunk per document (max-pooling by slug),
// so k=5 returns 5 *distinct* Wayfinder Paths rather than 5 chunks from 2 paths.
// This gives the agent broader grounding context per call.

export const searchCorpus = createTool({
  id: 'searchCorpus',
  // This description is the routing mechanism — the model reads it to decide
  // when to call this tool. It must be specific enough that wallet/price queries
  // don't trigger it, and broad enough that any corpus-relevant query does.
  description:
    'Searches the Wayfinder Paths corpus — a library of AI agent orchestration workflow definitions ' +
    '(monitors, strategies, policies, bundles). Use for questions about specific named paths, skill ' +
    'definitions, workflow archetypes, orchestration patterns, DeFi automation strategies described ' +
    'in the corpus, or any question about how Wayfinder organizes agent workflows. ' +
    'Do NOT use for live on-chain data, current token prices, wallet balances, or portfolio queries — ' +
    'use the Zapper tools for those.',
  inputSchema: z.object({
    query: z.string().describe('The search query — phrase it as a question or keyword set'),
    k: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe('Number of distinct documents to return (default 5)'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        section: z.string().nullable(),
        chunkType: z.string(),
        text: z.string(),
        similarity: z.number(),
      }),
    ),
    query: z.string(),
    retrievedAt: z.string(),
  }),
  execute: async ({ query, k = 5 }) => {
    const start = Date.now();
    let raw;
    try {
      raw = await searchDeduped(query, k);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[searchCorpus] ERROR query="${query}":`, msg);
      throw err;
    }

    const results = raw.map((r) => ({
      slug: r.slug,
      title: r.title,
      section: r.section,
      chunkType: r.chunkType,
      // Truncate long chunks to ~600 chars to stay within context budget.
      // Full chunks can be 2k+ chars; 5 × 2k = 10k chars before we've even
      // included MCP results + history + system prompt. 600 chars ≈ 150 tokens.
      text: r.text.length > 600 ? r.text.slice(0, 600) + '…' : r.text,
      similarity: Math.round(r.similarity * 1000) / 1000,
    }));

    console.log(
      `[searchCorpus] query="${query}" k=${k} hits=${results.length} latency=${Date.now() - start}ms`,
    );

    return { results, query, retrievedAt: new Date().toISOString() };
  },
});
