import path from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { Observability } from '@mastra/observability';
import { LangfuseExporter } from '@mastra/langfuse';
import { portfolioAgent } from './agents/portfolio-agent';
import { portfolioWorkflow } from './workflows/portfolio-workflow';

// Fallback to local SQLite when Turso env vars are absent (local dev without credentials).
const DB_PATH = path.join(process.cwd(), 'mastra.db');

const storage = new LibSQLStore({
  id: 'mastra-storage',
  url: process.env.TURSO_DATABASE_URL ?? `file:${DB_PATH}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// LangfuseExporter sends spans over HTTPS to cloud.langfuse.com.
// Unlike DefaultExporter (local DuckDB file), spans survive container teardown.
// Call langfuseExporter.flush() (not shutdown()) at the end of each serverless
// request — flush sends pending spans and keeps the exporter alive for the next
// request; shutdown() terminates it and drops subsequent spans.
export const langfuseExporter = new LangfuseExporter({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL,
});

const observability = new Observability({
  configs: {
    default: {
      serviceName: 'portfolio-agent',
      exporters: [langfuseExporter],
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
