/** TEST-4.6 crosses complete process exits; each worker asserts actual facade outcomes. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@jest/globals';

test('source failure and three-hour quota leave complete people reusable and folds honest across repair', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-mixed-people-'));
  try {
    for (const phase of ['initial', 'early', 'due', 'repair', 'unchanged']) {
      const child = spawnSync(process.execPath, [fileURLToPath(new URL('./gap-hunt-durability-mixed-people-worker.js', import.meta.url)), directory, phase], { encoding: 'utf8', timeout: 15000 });
      expect({ phase, status: child.status, signal: child.signal, stderr: child.stderr }).toEqual({ phase, status: 0, signal: null, stderr: '' });
      const output: unknown = JSON.parse(child.stdout);
      expect(output).toMatchObject({ phase });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
