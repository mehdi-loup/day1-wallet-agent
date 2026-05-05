/**
 * Day 12 — RAG eval runner (6 cases: 3 grounded, 3 ungrounded)
 *
 * Run: pnpm tsx evals/run-rag.ts
 */

// Env must be loaded BEFORE any module that reads process.env at init time
// (portfolio-agent.ts calls zapperMCP.listTools() in top-level await, which
// reads ZAPPER_API_KEY at module evaluation — too early for a post-import load).
// With ESM, static imports are hoisted, so we load env first then dynamic-import.
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
}

// Dynamic import ensures env vars are set before mcp.ts evaluates.
const { generateText, generateObject, stepCountIs } = await import('ai');
const { createAnthropic } = await import('@ai-sdk/anthropic');
const { z } = await import('zod');
const { getTokenPrice } = await import('../lib/tools/price.js');
const { searchCorpus } = await import('../lib/tools/search-corpus.js');
const { zapperMCP } = await import('../src/mastra/mcp.js');

const anthropicProvider = createAnthropic({ baseURL: 'https://api.anthropic.com/v1' });
const judgeModel = anthropicProvider('claude-haiku-4-5-20251001');

async function judge(response: string, rubric: string): Promise<{ passed: boolean; reason: string }> {
  const { object } = await generateObject({
    model: judgeModel,
    schema: z.object({ passed: z.boolean(), reason: z.string() }),
    prompt: `You are an impartial evaluator.\n\nRubric: ${rubric}\n\nResponse to evaluate:\n"${response}"\n\nReturn passed: true if ALL rubric requirements are met.`,
  });
  return object;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractToolNames(steps: any[]): string[] {
  return (steps ?? []).flatMap((s) =>
    (s.toolCalls ?? []).map((tc: { payload?: { toolName?: string }; toolName?: string }) =>
      tc.payload?.toolName ?? tc.toolName,
    ),
  );
}

type RagCase = {
  id: string;
  category: 'grounded' | 'ungrounded';
  input: string;
  expectedToolCall: string | null;
  rubric: string;
};

const RAG_CASES: RagCase[] = [
  // ── Grounded ───────────────────────────────────────────────────────────────
  {
    id: 'rag-grounded-conditional-router',
    category: 'grounded',
    input: 'What is the Conditional Router Reference path and what type of path is it?',
    expectedToolCall: 'searchCorpus',
    rubric:
      'The response must describe the Conditional Router Reference as a policy or routing-type ' +
      'Wayfinder path. It must NOT claim it is a monitor or strategy type. ' +
      'It must NOT claim to have no information about this path.',
  },
  {
    id: 'rag-grounded-delta-neutral',
    category: 'grounded',
    input: 'What Wayfinder paths relate to delta-neutral strategies?',
    expectedToolCall: 'searchCorpus',
    rubric:
      'The response must mention at least one delta-neutral related Wayfinder path by name ' +
      '(e.g. virtual-delta-neutral, KAITO PT Delta-Neutral, or similar). ' +
      'It must NOT fabricate path names not in the retrieved results.',
  },
  {
    id: 'rag-grounded-ens-manager',
    category: 'grounded',
    input: 'What does the ENS Manager path do?',
    expectedToolCall: 'searchCorpus',
    rubric:
      'The response must describe the ENS Manager path in terms of ENS (Ethereum Name Service) ' +
      'or domain/name management. It must NOT conflate this with a financial strategy path.',
  },
  // ── Ungrounded ─────────────────────────────────────────────────────────────
  {
    id: 'rag-ungrounded-eip4337',
    category: 'ungrounded',
    input: 'What is EIP-4337 and how does account abstraction work?',
    expectedToolCall: null,
    rubric:
      'The response must NOT attribute the EIP-4337 explanation to the Wayfinder Paths corpus. ' +
      'Phrases like "according to the corpus" or "the corpus describes" applied to EIP-4337 are a failure.',
  },
  {
    id: 'rag-ungrounded-fake-eip',
    category: 'ungrounded',
    input: 'What does EIP-99999 define?',
    expectedToolCall: null,
    rubric:
      'The response must acknowledge that EIP-99999 does not exist or the agent has no information. ' +
      'It must NOT describe any definition or purpose for EIP-99999.',
  },
  {
    id: 'rag-ungrounded-price-routing',
    category: 'ungrounded',
    input: 'What is the current price of USDC?',
    expectedToolCall: 'getTokenPrice',
    rubric:
      'The response must provide a USDC price or acknowledge it cannot be fetched. ' +
      'It must NOT call searchCorpus for a price query.',
  },
];

type Result = { id: string; category: string; passed: boolean; tools: string[]; detail: string };

const SYSTEM_PROMPT = `You are a DeFi portfolio analyst with two knowledge sources:

**Live on-chain data (Zapper tools)** — use for anything about a specific wallet:
- zapper-mcp_get_portfolio: full breakdown (tokens + DeFi positions + total USD). Default for "what's in this wallet?".
- zapper-mcp_get_token_balances: spot token holdings only. Use for "does this wallet hold X?" or chain-specific token questions.
- zapper-mcp_get_app_positions: DeFi protocol positions only (Aave debt, Uniswap LP, staking). Use for leverage, yield, or protocol questions.
- getTokenPrice: standalone price queries only (e.g. "what's ETH at?"). Do NOT call after a portfolio query — balanceUSD is already included.

**Corpus knowledge (searchCorpus)** — use for questions about Wayfinder Paths: named workflow paths, orchestration patterns, strategy definitions, or DeFi automation archetypes. Do NOT use for live wallet data or prices.

When you use searchCorpus results, attribute them: "According to the Wayfinder Paths corpus…". If the corpus has no relevant info, say so — do not fabricate a citation.

Be concise and precise — your users are technical.`;

async function main() {
  const mcpTools = await zapperMCP.listTools();
  const results: Result[] = [];
  let idx = 0;

  console.log('Day 12 — RAG eval (6 cases: 3 grounded, 3 ungrounded)\n');

  for (const c of RAG_CASES) {
    idx++;
    process.stdout.write(`  [${idx}/6] ${c.id} ... `);

    try {
      const result = await generateText({
        model: anthropicProvider('claude-haiku-4-5-20251001'),
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: c.input }],
        tools: { getTokenPrice, searchCorpus, ...mcpTools },
        stopWhen: [stepCountIs(6)],
      });
      const tools = extractToolNames(result.steps ?? []);

      if (c.expectedToolCall && !tools.includes(c.expectedToolCall)) {
        const r = { id: c.id, category: c.category, passed: false, tools, detail: `Expected tool "${c.expectedToolCall}" but got [${tools.join(', ') || 'none'}]` };
        results.push(r);
        console.log(`❌ wrong tool — ${r.detail}`);
        continue;
      }

      const { passed, reason } = await judge(result.text, c.rubric);
      results.push({ id: c.id, category: c.category, passed, tools, detail: reason });
      console.log(passed ? `✅ pass (tools: [${tools.join(', ') || 'none'}])` : `❌ fail — ${reason}`);
      if (!passed) console.log(`     response snippet: ${result.text.slice(0, 200)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: c.id, category: c.category, passed: false, tools: [], detail: `threw: ${msg}` });
      console.log(`❌ error — ${msg}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const grounded = results.filter((r) => r.category === 'grounded');
  const ungrounded = results.filter((r) => r.category === 'ungrounded');
  const gPassed = grounded.filter((r) => r.passed).length;
  const uPassed = ungrounded.filter((r) => r.passed).length;

  console.log('\n─────────────────────────────────────');
  console.log(`  Grounded:   ${gPassed}/${grounded.length} passed`);
  console.log(`  Ungrounded: ${uPassed}/${ungrounded.length} passed`);
  console.log(`  Total:      ${gPassed + uPassed}/6 passed`);
  console.log('─────────────────────────────────────');

  process.exit(gPassed + uPassed < 6 ? 1 : 0);
}

main().catch((err) => {
  console.error('RAG eval crashed:', err);
  process.exit(1);
});
