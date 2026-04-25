import path from 'node:path';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { portfolioAgent } from './agents/portfolio-agent';
import { portfolioWorkflow } from './workflows/portfolio-workflow';

// Absolute path avoids the relative-path mismatch between `next dev` (cwd = project root)
// and `mastra dev` (cwd may differ depending on how it's invoked).
const DB_PATH = path.join(process.cwd(), 'mastra.db');

export const mastra = new Mastra({
  agents: { portfolioAgent },
  workflows: { portfolioWorkflow },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: `file:${DB_PATH}`,
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
