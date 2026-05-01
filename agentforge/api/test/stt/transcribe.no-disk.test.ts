/**
 * Gate 5 G5-02 — STT path must not persist audio via filesystem helpers (PRD §5.8 / S3).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { transcribeInMemoryAudio } from '../../src/stt/transcribe.js';
import { testEnv } from '../helpers/env-fixture.js';

describe('transcribeInMemoryAudio', () => {
  it('mock provider returns text without touching disk APIs in module source', async () => {
    const env = testEnv({ STT_PROVIDER: 'mock' });
    const out = await transcribeInMemoryAudio(env, new Uint8Array([1, 2, 3]), 'audio/webm');
    expect(out.text).toContain('Mock dictation');

    const transcribeSrc = readFileSync(
      fileURLToPath(new URL('../../src/stt/transcribe.ts', import.meta.url)),
      'utf8',
    );
    const wsSrc = readFileSync(fileURLToPath(new URL('../../src/stt/ws_route.ts', import.meta.url)), 'utf8');
    for (const src of [transcribeSrc, wsSrc]) {
      expect(src).not.toMatch(/writeFileSync|createWriteStream|fs\.promises\.writeFile|appendFileSync/u);
      expect(src).not.toMatch(/\.wav|\.mp3|\.flac|\.ogg|\.opus|\.webm|\.m4a/u);
    }
  });
});
