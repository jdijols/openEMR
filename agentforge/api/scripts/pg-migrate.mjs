/**
 * Gate 3 (G3-00) — apply SQL migrations in order against POSTGRES_URL.
 * Stops on first error; idempotent migrations use IF NOT EXISTS / ON CONFLICT.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');

async function main() {
  /** Host runs: use 127.0.0.1 + published port (`docker-compose.override` maps 15432). `postgres` DNS exists only inside Compose. */
  const conn =
    (process.env.POSTGRES_URL_MIGRATE && process.env.POSTGRES_URL_MIGRATE.trim() !== '') ?
      process.env.POSTGRES_URL_MIGRATE.trim()
    : (process.env.POSTGRES_URL ?? '').trim();
  if (!conn || conn.trim() === '') {
    console.error(
      'No database URL: use POSTGRES_URL inside Docker, or POSTGRES_URL_MIGRATE when running migrations on the host (127.0.0.1:15432). See docker/agentforge/README.md § Agent Postgres baseline.',
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: conn });
  await client.connect();
  try {
    const files = (await readdir(dir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    if (files.length === 0) {
      console.error('No migrations in', dir);
      process.exit(1);
    }

    for (const f of files) {
      const sql = await readFile(path.join(dir, f), 'utf8');
      console.log('Applying migration', f);
      await client.query(sql);
    }
    console.log('Migrations OK:', files.join(', '));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
