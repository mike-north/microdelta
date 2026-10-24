import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';

/** Each launch exits completely; exact refs, not just printed equality, prove retention. */
describe('snapshot pipeline independent restarts', () => {
  test('retains stable summary and exact reference in a second same-store process', () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-cursor-'));
    const launch = (): unknown => JSON.parse(execFileSync(process.execPath, [join(import.meta.dirname, 'pipeline.js'), join(directory, 'history.sqlite')], { encoding: 'utf8' }));
    try {
      const first = launch();
      const second = launch();
      expect(first).toMatchObject({ calls: [null, 'page:2'], kind: 'published', data: { count: 4, total: 10, ids: [1, 2, 3, 4] } });
      expect(second).toMatchObject({ calls: [null, 'page:2'], kind: 'reused', data: { count: 4, total: 10, ids: [1, 2, 3, 4] } });
      if (typeof first !== 'object' || first === null || !('reference' in first) || typeof second !== 'object' || second === null || !('reference' in second)) { throw new Error('missing exact reference'); }
      expect(second.reference).toEqual(first.reference);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
