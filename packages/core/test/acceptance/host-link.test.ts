/** The acceptance preload preserves the built facade's real read capability exports. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@jest/globals';

test('acceptance preload links the built finite History selection without opening storage', () => {
  const preload = fileURLToPath(new URL('./register.js', import.meta.url));
  const facade = new URL('../../../dist/src/index.js', import.meta.url).href;
  const script = "const facade = await import(process.argv[1]); if (typeof facade.readHistorySelection !== 'function') throw new Error('finite selection export missing');";
  const result = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '--eval', script, facade], { encoding: 'utf8', timeout: 60_000 });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
});
