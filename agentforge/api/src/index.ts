import { serve } from '@hono/node-server';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { createObservability } from './observability/index.js';

const env = loadEnv();
const observability = createObservability(env);
const app = buildApp(env, observability);

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

serve({ fetch: app.fetch, port }, () => {
  console.info(`agentforge-api listening on ${port}`);
});
