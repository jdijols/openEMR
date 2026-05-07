import moduleJson from '../../../contracts/module-http-paths.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { MODULE_HTTP_PATHS } from '../../src/openemr/types.js';

describe('module HTTP contract drift', () => {
  it('TypeScript MODULE_HTTP_PATHS matches canonical JSON', () => {
    const fromJson = [...moduleJson.paths].sort();
    const fromTs = [...MODULE_HTTP_PATHS].sort();
    expect(fromTs).toEqual(fromJson);
    expect(fromTs).toHaveLength(22);
  });
});
