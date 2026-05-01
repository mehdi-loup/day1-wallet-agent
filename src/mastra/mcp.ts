import path from 'node:path';
import { MCPClient } from '@mastra/mcp';

// Resolve path relative to the wallet-agent root, not the CWD of the runner.
// The Day 9 server must be pre-built (`pnpm build` in day9-zapper-mcp/).
// If build/server.js is stale, the spawn will fail at first listTools() call.
const SERVER_PATH = path.resolve(
  process.cwd(),
  '../day9-zapper-mcp/build/server.js',
);

// Singleton — one child process, reused across requests.
// Hot-reload gotcha: Next.js dev mode re-evaluates this module on each file
// save. The old MCPClient's subprocess is orphaned (GC does not SIGKILL child
// processes). Multiple reloads → multiple zombie server.js processes. This is
// harmless in practice (each orphan eventually exits when its stdio stream
// closes) but means `ps aux | grep day9-zapper-mcp` can show several PIDs
// during a long dev session. Not a production concern — prod has no hot reload.
export const zapperMCP = new MCPClient({
  id: 'wallet-agent-zapper-mcp',
  servers: {
    'zapper-mcp': {
      command: 'node',
      args: [SERVER_PATH],
      // Pass only the key the server needs — not the whole process.env.
      // Security story: after lib/zapper.ts is deleted, this is the only place
      // ZAPPER_API_KEY appears in wallet-agent code. The agent itself never
      // calls Zapper; it only configures the child process that does.
      env: {
        ZAPPER_API_KEY: process.env.ZAPPER_API_KEY ?? '',
      },
    },
  },
});
