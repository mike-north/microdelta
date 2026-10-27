/** Node command transport provides process mechanics without command or observation policy. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@jest/globals';

/** A fresh process prevents its real stdout/stderr/exit code from affecting the test runner. */
function run(source: string, args: readonly string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-command-host-'));
  try {
    const entry = join(directory, 'entry.mjs');
    const adapter = new URL('../../dist/src/index.js', import.meta.url).href;
    writeFileSync(entry, `import { createNodeCommandProcess } from ${JSON.stringify(adapter)};\n${source}`);
    return spawnSync(process.execPath, [entry, ...args], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 10000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('arguments are detached and output is fully written before natural exit with the selected status', () => {
  const result = run(`const host = createNodeCommandProcess();
process.argv[2] = 'changed later';
host.setExitCode(7);
host.writeStdout(JSON.stringify({ arguments: host.arguments }) + '\\n');
host.writeStderr('host stderr é\\n');`, ['first', 'second']);
  expect(result.status).toBe(7);
  expect(result.stdout).toBe('{"arguments":["first","second"]}\n');
  expect(result.stderr).toBe('host stderr é\n');
});

test('invalid process statuses reject without choosing a different status', () => {
  const result = run(`const host = createNodeCommandProcess();
let refused = 0;
for (const code of [-1, 256, 1.5, Number.NaN]) { try { host.setExitCode(code); } catch { refused++; } }
host.writeStdout(String(refused));`);
  expect(result.status).toBe(0); expect(result.stdout).toBe('4'); expect(result.stderr).toBe('');
});
