/**
 * Lightweight Mastra instance for the eval runner.
 *
 * Intentionally excludes:
 *   - DuckDB / observability — avoids file lock conflict if mastra dev is running
 *   - ConsoleExporter / DefaultExporter — no trace noise during eval runs
 *
 * Uses a separate SQLite file (eval.db) so eval runs never pollute the dev memory store.
 */
import path from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { portfolioAgent } from '../src/mastra/agents/portfolio-agent';
import { portfolioWorkflow } from '../src/mastra/workflows/portfolio-workflow';

const EVAL_DB_PATH = path.join(process.cwd(), 'eval.db');

export const evalMastra = new Mastra({
  agents: { portfolioAgent },
  workflows: { portfolioWorkflow },
  storage: new LibSQLStore({
    id: 'eval-storage',
    url: `file:${EVAL_DB_PATH}`,
  }),
});
