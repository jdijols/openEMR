import { createNodeWebSocket } from '@hono/node-ws';
import { serve } from '@hono/node-server';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { createObservability } from './observability/index.js';
import { registerSttStreamRoute } from './stt/ws_route.js';

const env = loadEnv();
const observability = createObservability(env);
const pool = new Pool({ connectionString: env.POSTGRES_URL, max: 10 });
const app = buildApp(env, observability, pool);

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
  app,
  baseUrl: `http://127.0.0.1:${port}`,
});
registerSttStreamRoute(app, upgradeWebSocket, env, pool);

const server = serve({ fetch: app.fetch, port }, () => {
  console.info(`agentforge-api listening on ${port}`);
});
injectWebSocket(server);

const shutdown = async (signal: string): Promise<void> => {
  console.info('agentforge_api_shutdown_begin', { signal });
  try {
    await observability.shutdown();
  } finally {
    server.close(() => process.exit(0));
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
