import { tool } from 'ai';
import { z } from 'zod';
import { searchDeduped } from 'day11-rag';

export const searchCorpus = tool({
  description:
    'Searches the Wayfinder Paths corpus — a library of AI agent orchestration workflow definitions ' +
    '(monitors, strategies, policies, bundles). Use for questions about specific named paths, skill ' +
    'definitions, workflow archetypes, orchestration patterns, DeFi automation strategies described ' +
    'in the corpus, or any question about how Wayfinder organizes agent workflows. ' +
    'Do NOT use for live on-chain data, current token prices, wallet balances, or portfolio queries — ' +
    'use the Zapper tools for those.',
  inputSchema: z.object({
    query: z.string().describe('The search query — phrase it as a question or keyword set'),
    k: z.number().int().min(1).max(10).default(5).describe('Number of distinct documents to return (default 5)'),
  }),
  execute: async ({ query, k = 5 }) => {
    const start = Date.now();
    try {
      const raw = await searchDeduped(query, k);
      const results = raw.map((r) => ({
        slug: r.slug,
        title: r.title,
        section: r.section,
        chunkType: r.chunkType,
        text: r.text.length > 600 ? r.text.slice(0, 600) + '…' : r.text,
        similarity: Math.round(r.similarity * 1000) / 1000,
      }));
      console.log(`[searchCorpus] query="${query}" k=${k} hits=${results.length} latency=${Date.now() - start}ms`);
      return { results, query, retrievedAt: new Date().toISOString() };
    } catch (err) {
      // Postgres error boundary: Supabase down or connection dropped.
      // Return an empty result set with an error flag so the agent can acknowledge
      // the outage rather than hallucinating corpus content.
      console.error('[searchCorpus] Postgres unavailable:', err instanceof Error ? err.message : err);
      return {
        results: [],
        query,
        retrievedAt: new Date().toISOString(),
        error: 'Knowledge corpus temporarily unavailable.',
      };
    }
  },
});
