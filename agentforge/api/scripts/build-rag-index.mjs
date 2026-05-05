#!/usr/bin/env node
/**
 * §8 / G2-MVP-54 — Build the W2 RAG index.
 *
 * Reads markdown guidelines from `eval/guidelines/`, splits each by `##`
 * section headings, embeds each chunk with bge-small (384-d) via
 * @xenova/transformers, and upserts into `rag_chunks`. Idempotent on
 * `chunk_id`.
 *
 * Run from agentforge/api/ via `npm run rag-index` (which loads dev
 * secrets and POSTGRES_URL).
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from '@xenova/transformers';
import pg from 'pg';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const guidelinesDir = join(__dirname, '..', 'eval', 'guidelines');

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseGuideline(filename, raw) {
  // First non-empty paragraph after the # title may include "Source URL: ...".
  const sourceUrlMatch = raw.match(/Source URL:\s*(\S+)/);
  const sourceUrl = sourceUrlMatch ? sourceUrlMatch[1] : 'about:blank';

  const fileSlug = filename.replace(/\.md$/, '');
  const sections = [];

  const lines = raw.split('\n');
  let currentSection = null;
  let currentBody = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      if (currentSection !== null && currentBody.length > 0) {
        const text = currentBody.join('\n').trim();
        if (text.length > 0) {
          sections.push({
            chunk_id: `${fileSlug}#${slugify(currentSection)}`,
            section: currentSection,
            text,
            source_url: sourceUrl,
          });
        }
      }
      currentSection = headingMatch[1];
      currentBody = [];
    } else if (currentSection !== null) {
      currentBody.push(line);
    }
  }
  if (currentSection !== null && currentBody.length > 0) {
    const text = currentBody.join('\n').trim();
    if (text.length > 0) {
      sections.push({
        chunk_id: `${fileSlug}#${slugify(currentSection)}`,
        section: currentSection,
        text,
        source_url: sourceUrl,
      });
    }
  }
  return sections;
}

async function main() {
  const databaseUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('POSTGRES_URL not set; refusing to run.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: databaseUrl });

  console.log(`Loading bge-small embedder…`);
  const embedder = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');

  const files = (await readdir(guidelinesDir)).filter((f) => f.endsWith('.md'));
  if (files.length === 0) {
    console.error('No guideline markdown files found in', guidelinesDir);
    process.exit(1);
  }
  console.log(`Found ${files.length} guideline file(s):`, files);

  let totalChunks = 0;
  for (const file of files) {
    const raw = await readFile(join(guidelinesDir, file), 'utf8');
    const sections = parseGuideline(file, raw);
    console.log(`  ${file}: ${sections.length} sections`);

    for (const sec of sections) {
      const out = await embedder(sec.text, { pooling: 'mean', normalize: true });
      const vec = Array.from(out.data);
      const vecLiteral = `[${vec.join(',')}]`;

      await pool.query(
        `INSERT INTO rag_chunks (chunk_id, section, text, source_url, source_type, embedding)
         VALUES ($1, $2, $3, $4, 'guideline_chunk', $5::vector)
         ON CONFLICT (chunk_id) DO UPDATE SET
           section = EXCLUDED.section,
           text = EXCLUDED.text,
           source_url = EXCLUDED.source_url,
           embedding = EXCLUDED.embedding`,
        [sec.chunk_id, sec.section, sec.text, sec.source_url, vecLiteral],
      );
      totalChunks++;
    }
  }

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM rag_chunks');
  console.log(`\nrag_chunks total rows: ${rows[0]?.n}; this run upserted ${totalChunks} chunks.`);

  await pool.end();
}

main().catch((err) => {
  console.error('build-rag-index failed:', err);
  process.exit(1);
});
