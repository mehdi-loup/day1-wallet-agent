import path from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { MastraCompositeStore } from '@mastra/core/storage';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { Observability, DefaultExporter, ConsoleExporter } from '@mastra/observability';
import { portfolioAgent } from './agents/portfolio-agent';
import { portfolioWorkflow } from './workflows/portfolio-workflow';

// Local file path — only used when TURSO_DATABASE_URL is not set (local dev without Turso).
const DB_PATH = path.join(process.cwd(), 'mastra.db');
const OBS_DB_PATH = path.join(process.cwd(), 'observability.db');

// MastraCompositeStore routes storage by domain:
//   - default → LibSQL (OLTP: threads, messages, memory)
//     Production: Turso remote instance (survives redeployments + is shared across instances).
//     Local dev fallback: SQLite file (fine for single-process dev, invisible on Vercel).
//   - observability → DuckDB (OLAP: spans, traces, metrics with aggregate queries)
const duckdb = new DuckDBStore({ path: OBS_DB_PATH });

const storage = new MastraCompositeStore({
  id: 'composite-storage',
  default: new LibSQLStore({
    id: 'mastra-storage',
    url: process.env.TURSO_DATABASE_URL ?? `file:${DB_PATH}`,
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
  domains: {
    observability: duckdb.observability,
  },
});

// DefaultExporter → persists spans to DuckDB; Studio reads from there.
// ConsoleExporter → prints span JSON to stdout so you can read traces without opening Studio.
//   Remove ConsoleExporter in production — it's noisy.
const observability = new Observability({
  configs: {
    default: {
      serviceName: 'portfolio-agent',
      exporters: [new DefaultExporter(), new ConsoleExporter()],
    },
  },
});

export const mastra = new Mastra({
  agents: { portfolioAgent },
  workflows: { portfolioWorkflow },
  storage,
  observability,
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
