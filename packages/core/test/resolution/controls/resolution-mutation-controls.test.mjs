/**
 * The Resolution mutation runner owns a disposable package checkout. A handled
 * signal must let the runner unwind through its normal cleanup so that a
 * cancelled evidence run does not strand a second 221 MB workspace in tmp.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const runner = fileURLToPath(new URL('./resolution-mutation-controls.mjs', import.meta.url));
const resolutionArtifact = join(root, 'packages/resolution/dist/src/resolution.js');

/** Report directories share the same prefix, so identify the full package copy by its emitted artifact. */
function isolatedCheckouts(directory) {
  return readdirSync(directory).filter(name => existsSync(join(directory, name, 'packages/resolution/dist/src/resolution.js')));
}

/** Wait until a preload confirms the runner's second Jest child is suspended. */
function waitForFile(path, child, timeoutMilliseconds) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (child.exitCode !== null || child.signalCode !== null) {
        clearInterval(poll);
        reject(new Error(`runner exited before the signal point: code ${String(child.exitCode)}, signal ${String(child.signalCode)}`));
      } else if (existsSync(path)) {
        clearInterval(poll);
        resolve();
      } else if (Date.now() - started > timeoutMilliseconds) {
        clearInterval(poll);
        reject(new Error(`timed out waiting for ${path}`));
      }
    }, 20);
  });
}

/** Observe the child exit after a signal without blocking the test event loop. */
function waitForExit(child, timeoutMilliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mutation runner did not exit after SIGTERM')), timeoutMilliseconds);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('SIGTERM during a planted control removes the isolated checkout and leaves source bytes intact', async () => {
  const original = readFileSync(resolutionArtifact);
  const temporary = mkdtempSync(join(tmpdir(), 'resolution-control-signal-test-'));
  const counter = join(temporary, 'jest-count');
  const reached = join(temporary, 'mutation-running');
  const preload = join(temporary, 'hold-second-jest.mjs');
  writeFileSync(preload, `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const counter = ${JSON.stringify(counter)};
const reached = ${JSON.stringify(reached)};
if (process.argv.some((argument) => argument.includes('/jest/bin/jest.js'))) {
  const count = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
  writeFileSync(counter, String(count + 1));
  if (count === 1) {
    writeFileSync(reached, 'ready');
    setInterval(() => undefined, 1000);
    await new Promise(() => undefined);
  }
}
`);
  let child;
  let stdout = '';
  try {
    child = spawn(process.execPath, [runner], {
      cwd: root,
      env: {
        ...process.env,
        TMPDIR: temporary,
        NODE_OPTIONS: `--import=${preload}`,
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    await waitForFile(reached, child, 60_000);
    const checkouts = isolatedCheckouts(temporary);
    assert.equal(checkouts.length, 1, 'runner must own one isolated checkout at the signal point');
    const copiedArtifact = join(temporary, checkouts[0], 'packages/resolution/dist/src/resolution.js');
    assert.notDeepEqual(readFileSync(copiedArtifact), original, 'the signal must arrive while a mutant is planted');

    child.kill('SIGTERM');
    assert.deepEqual(await waitForExit(child, 10_000), { code: 130, signal: null });
    assert.match(stdout, /INTERRUPTED by SIGTERM; emitted files restored/u);
    assert.deepEqual(isolatedCheckouts(temporary), [], 'the interrupted runner must remove its isolated checkout');
    assert.deepEqual(readFileSync(resolutionArtifact), original, 'source build bytes must remain unchanged');
  } finally {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child, 10_000).catch(() => undefined);
    }
    rmSync(temporary, { recursive: true, force: true });
  }
});
