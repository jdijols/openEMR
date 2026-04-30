import { parseEnv } from '../src/env.js';

try {
  parseEnv(process.env);
} catch {
  process.exit(1);
}
