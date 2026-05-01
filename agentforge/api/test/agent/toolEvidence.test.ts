/**
 * Indexes citation_navigation hints from mocked tool payloads (Gate 3 / PRD §4.5).
 */
import { describe, expect, it } from 'vitest';
import { buildCitationNavigationIndex } from '../../src/agent/toolEvidence.js';

describe('buildCitationNavigationIndex', () => {
  it('maps source_pack.uuid to navigation_hint objects from nested rows', () => {
    const index = buildCitationNavigationIndex([
      {
        type: 'tool-result',
        output: {
          ok: true,
          data: [
            {
              visit: 'acute',
              source_pack: {
                resource_family: 'encounter',
                table: 'form_encounter',
                row_id: 7,
                uuid: 'row-uu-enc',
                as_of: '2026-04-01T00:00:00Z',
                retrieval_path: 'EncounterService::search',
                navigation_hint: { kind: 'encounter', params: { encounter_id: 42 } },
              },
            },
          ],
        },
      },
    ]);

    expect(index['row-uu-enc']).toEqual({
      kind: 'encounter',
      params: { encounter_id: 42 },
    });
  });

  it('returns an empty record when tool results omit source packs', () => {
    expect(buildCitationNavigationIndex([{ type: 'tool-result', output: { ok: true } }])).toEqual({});
  });
});
