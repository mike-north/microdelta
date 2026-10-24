import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';

/** Page sends occur inside the source; observers count actual bodies separately. */
describe('source-body pagination across independent processes', () => {
  test('cold traverses both pages once; current accepted restart traverses none', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-source-cursor-'));
    const launch = (): { readonly value: unknown; readonly pages: readonly string[] } => {
      const result = spawnSync(process.execPath, [join(import.meta.dirname, 'source-pagination.js'), join(directory, 'history.sqlite')], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      return { value: JSON.parse(result.stdout), pages: result.stderr.split('\n').filter(line => line.startsWith('provider-page:')) };
    };
    try {
      const first = launch();
      const second = launch();
      expect(first.pages).toEqual(['provider-page:null', 'provider-page:page:2']);
      expect(second.pages).toEqual([]);
      expect(first.value).toMatchObject({ kind: 'published', executions: { snapshot: 1, summary: 1 }, data: { count: 4, total: 10, ids: [1, 2, 3, 4] } });
      expect(second.value).toMatchObject({ kind: 'reused', executions: {}, data: { count: 4, total: 10, ids: [1, 2, 3, 4] } });
      if (typeof first.value !== 'object' || first.value === null || !('reference' in first.value) || typeof second.value !== 'object' || second.value === null || !('reference' in second.value)) { throw new Error('missing exact reference'); }
      expect(second.value.reference).toEqual(first.value.reference);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
