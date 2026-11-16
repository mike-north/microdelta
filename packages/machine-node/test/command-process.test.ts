/** Node command transport provides process mechanics without command or observation policy. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@jest/globals';

/** A fresh process prevents its real stdout/stderr/exit code from affecting the test runner. */
function run(source: string, args: readonly string[] = [], moduleSource = "export const value = 'selected';\n") {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-command-host-'));
  try {
    const entry = join(directory, 'entry.mjs');
    writeFileSync(join(directory, 'picked.mjs'), moduleSource);
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

test('local module and path facilities resolve only the selected module against the process directory', () => {
  const result = run(`const host = createNodeCommandProcess();
const path = host.resolvePath('picked.mjs');
const modulePath = new URL('./picked.mjs', import.meta.url).pathname;
host.loadModule(modulePath).then((loaded) => host.writeStdout(JSON.stringify({ path, value: loaded.value })));`);
  expect(result.stdout).toBe(`${JSON.stringify({ path: join(fileURLToPath(new URL('../../', import.meta.url)), 'picked.mjs'), value: 'selected' })}`);
  expect(result.status).toBe(0);
});

test('signal subscriptions and process keep-alive are released exactly once', () => {
  const result = run(`const host = createNodeCommandProcess();
const release = host.keepAlive();
let count = 0;
const unsubscribe = host.onSignal('SIGINT', () => { count++; });
process.emit('SIGINT');
unsubscribe(); unsubscribe();
process.emit('SIGINT');
release(); release();
host.writeStdout(String(count));`);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('1');
});
