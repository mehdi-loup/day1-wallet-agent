/**
 * Day 6 — eval runner
 *
 * pnpm eval — runs the 10-case golden set and prints a pass/fail summary.
 * Exits non-zero on any failure so it can gate CI.
 *
 * Strategies:
 *   deterministic  — boolean assertions on tool calls (fast, cheap, no LLM calls)
 *   llm-judge      — custom Anthropic judge scores the response against a rubric
 *   workflow-zod   — runs the 3-step Mastra workflow; asserts Zod schema conformance
 *   snapshot       — workflow run where we assert the output SHAPE matches a stored snapshot
 *
 * Observability vs evals distinction (keep this in mind as you read):
 *   - Deterministic evals catch wrong tool choice, missing refusals, schema violations.
 *   - LLM-as-judge catches hallucination and tone failures that code can't express.
 *   - Neither tells you *why* it failed — that's what traces are for.
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { PortfolioSummarySchema } from '../lib/schemas/portfolio';
import { evalMastra } from './eval-mastra';
import { cases, type EvalCase } from './cases';

// ── Env loading ───────────────────────────────────────────────────────────────
// Next.js reads .env.local automatically; standalone scripts do not.
// We parse it manually rather than adding another dependency.
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
}

// ── Anthropic judge model ─────────────────────────────────────────────────────
// Haiku is cheap and fast for judge calls. Using the same model family as the
// agent avoids systematic judge bias (a judge that shares training with the
// agent tends to agree with it).
const anthropicProvider = createAnthropic({ baseURL: 'https://api.anthropic.com/v1' });
const judgeModel = anthropicProvider('claude-haiku-4-5-20251001');

// ── Snapshot store ────────────────────────────────────────────────────────────
const SNAPSHOT_PATH = path.join(process.cwd(), 'evals', 'snapshot.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract all tool names called across every agent step. */
function extractToolNames(steps: any[]): string[] {
  return steps.flatMap((s) =>
    (s.toolCalls ?? []).map((tc: any) => tc.payload?.toolName ?? tc.toolName),
  );
}

type Result = { id: string; passed: boolean; detail: string };

/** LLM-as-judge: returns true if the response satisfies the rubric. */
async function judgeResponse(response: string, rubric: string): Promise<{ passed: boolean; reason: string }> {
  const { object } = await generateObject({
    model: judgeModel,
    schema: z.object({
      passed: z.boolean().describe('true if the response satisfies the rubric'),
      reason: z.string().describe('one sentence explanation'),
    }),
    prompt: `You are an impartial evaluator. Score this AI response against the rubric.

Rubric: ${rubric}

Response to evaluate:
"${response}"

Return passed: true if the response satisfies ALL rubric requirements, false otherwise.`,
  });
  return object;
}

// ── Eval strategies ───────────────────────────────────────────────────────────

async function runDeterministic(c: EvalCase, agent: any): Promise<Result> {
  const result = await agent.generate(
    [{ role: 'user', content: c.input }],
    { threadId: `eval-${c.id}`, resourceId: 'eval-runner' },
  );

  const toolNames = extractToolNames(result.steps ?? []);
  const calledTool = toolNames.length > 0;

  // Check tool call expectation
  if (c.expectedToolCall) {
    const correct = toolNames.includes(c.expectedToolCall);
    if (!correct) {
      return { id: c.id, passed: false, detail: `Expected tool "${c.expectedToolCall}" but got [${toolNames.join(', ') || 'none'}]` };
    }
  }
  if (c.expectNoToolCall && calledTool) {
    return { id: c.id, passed: false, detail: `Expected no tool call but got [${toolNames.join(', ')}]` };
  }

  // Optional judge pass on top of the deterministic check
  if (c.judgeRubric) {
    const { passed, reason } = await judgeResponse(result.text, c.judgeRubric);
    if (!passed) {
      return { id: c.id, passed: false, detail: `Tool check passed but judge failed: ${reason}` };
    }
  }

  return { id: c.id, passed: true, detail: toolNames.length ? `called [${toolNames.join(', ')}]` : 'no tool (correct)' };
}

async function runLlmJudge(c: EvalCase, agent: any): Promise<Result> {
  const result = await agent.generate(
    [{ role: 'user', content: c.input }],
    { threadId: `eval-${c.id}`, resourceId: 'eval-runner' },
  );

  const toolNames = extractToolNames(result.steps ?? []);

  // Optional tool call check (same as deterministic)
  if (c.expectedToolCall && !toolNames.includes(c.expectedToolCall)) {
    return { id: c.id, passed: false, detail: `Expected tool "${c.expectedToolCall}", got [${toolNames.join(', ') || 'none'}]` };
  }

  if (!c.judgeRubric) {
    return { id: c.id, passed: false, detail: 'llm-judge case missing judgeRubric' };
  }

  const { passed, reason } = await judgeResponse(result.text, c.judgeRubric);
  return { id: c.id, passed, detail: reason };
}

async function runWorkflowZod(c: EvalCase, wf: any): Promise<Result> {
  const run = await wf.createRun();
  const result = await run.start({ inputData: { walletAddress: c.input } });

  const parse = PortfolioSummarySchema.safeParse(result.result);
  if (!parse.success) {
    return {
      id: c.id,
      passed: false,
      detail: `Zod parse failed: ${parse.error.issues.map((i) => i.message).join('; ')}`,
    };
  }
  return {
    id: c.id,
    passed: true,
    detail: `Schema valid. totalUsd=$${parse.data.totalUsd.toFixed(2)}, holdings=${parse.data.topHoldings.length}`,
  };
}

async function runSnapshot(c: EvalCase, wf: any): Promise<Result> {
  const run = await wf.createRun();
  const result = await run.start({ inputData: { walletAddress: c.input } });

  // We assert on SHAPE (key names + types), not exact values.
  // Prices and balances change every run; the schema doesn't.
  const shapeSnapshot = {
    hasWalletAddress: typeof result.result?.walletAddress === 'string',
    hasTotalUsd: typeof result.result?.totalUsd === 'number',
    hasTopHoldings: Array.isArray(result.result?.topHoldings),
    hasRiskNotes: typeof result.result?.riskNotes === 'string',
    hasGeneratedAt: typeof result.result?.generatedAt === 'string',
  };

  if (fs.existsSync(SNAPSHOT_PATH)) {
    // Regression: compare current shape to stored shape
    const stored = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    const mismatches = Object.entries(shapeSnapshot)
      .filter(([k, v]) => stored[k] !== v)
      .map(([k]) => k);

    if (mismatches.length > 0) {
      return { id: c.id, passed: false, detail: `Shape regression on keys: ${mismatches.join(', ')}` };
    }
    return { id: c.id, passed: true, detail: 'Shape matches stored snapshot' };
  }

  // First run: write the snapshot
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(shapeSnapshot, null, 2));
  return { id: c.id, passed: true, detail: 'Snapshot written (first run — always passes)' };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const agent = evalMastra.getAgent('portfolioAgent');
  const workflow = evalMastra.getWorkflow('portfolioWorkflow');

  const results: Result[] = [];
  let idx = 0;

  for (const c of cases) {
    idx++;
    process.stdout.write(`  [${idx}/${cases.length}] ${c.id} ... `);

    try {
      let r: Result;
      switch (c.evalType) {
        case 'deterministic':  r = await runDeterministic(c, agent);  break;
        case 'llm-judge':      r = await runLlmJudge(c, agent);       break;
        case 'workflow-zod':   r = await runWorkflowZod(c, workflow);  break;
        case 'snapshot':       r = await runSnapshot(c, workflow);     break;
      }
      results.push(r);
      console.log(r.passed ? '✅ pass' : `❌ fail — ${r.detail}`);
    } catch (err: any) {
      const r: Result = { id: c.id, passed: false, detail: `threw: ${err.message ?? err}` };
      results.push(r);
      console.log(`❌ error — ${r.detail}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log('\n─────────────────────────────────────');
  console.log(`  ${passed}/${results.length} passed`);
  if (failed > 0) {
    console.log('\n  Failures:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`    ✗ ${r.id}: ${r.detail}`));
  }
  console.log('─────────────────────────────────────');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Eval runner crashed:', err);
  process.exit(1);
});
