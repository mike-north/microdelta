/** Installed-command acceptance for CLI-005: exact observation grants no execution or mutation authority. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { createNodeSqlite } from '@microdelta/machine-node';

/** A real local install must expose the package's own bin, rather than a test-only command function. */
const directory = mkdtempSync(join(tmpdir(), 'microdelta-observe-bin-'));
/** Emitted tests run beneath this package's .test-build/test/cli directory. */
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
/** The exact fixture identity cannot be replaced by a public run correlation name. */
const executionId = 'a'.repeat(32);

beforeAll(() => {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'observe-cli-consumer', private: true }));
  const installed = spawnSync('npm', ['install', '--prefix', directory, '--ignore-scripts', '--offline', '--package-lock=false', '--no-audit', '--no-fund', packageRoot], { encoding: 'utf8' });
  expect(installed.status).toBe(0);
  expect(installed.error).toBeUndefined();
  // The executable's current directory contains deliberately unusable application
  // stores and an author module. Observation must neither discover nor open them.
  writeFileSync(join(directory, 'history.sqlite'), 'History must not be opened');
  writeFileSync(join(directory, 'accounting.sqlite'), 'Accounting must not be opened');
  writeFileSync(join(directory, 'analysis.mjs'), "throw new Error('analysis callbacks must not load');\n");
});
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });

/** Independent literal records distinguish successful reads from successful executions. */
function sample(failed = false): string {
  return JSON.stringify({ version: 1, result: { kind: 'observed', observation: {
    executionId, revision: 1, sampledAt: 1000, context: { runId: 'caller', analysis: 'caller-analysis', environment: 'caller-environment' }, phase: failed ? 'closed' : 'running',
    eventCounts: { step: 0, ordinary: 0, operation: 0, send: 0, wait: 0, promotion: 0, stop: 0, lowerBound: false },
    ...(failed ? { stop: { level: 'none' }, diagnostics: { present: true, count: 1, lowerBound: false }, interruptions: { cancelled: 0, running: 0, unknown: 0, lowerBound: false }, executionFailure: { kind: 'other' }, body: 'threw', application: { kind: 'not-classified' } } : {}),
  } } });
}
/** Only the established observation artifact is seeded; no workflow is executed. */
function seed(location: string, document: string): void {
  const connection = createNodeSqlite().openSqlite(location, { journalMode: 'delete' });
  try {
    connection.exec('CREATE TABLE microdelta_execution_observation (slot INTEGER PRIMARY KEY CHECK (slot = 1), execution_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL)');
    connection.prepare('INSERT INTO microdelta_execution_observation (slot, execution_id, revision, document) VALUES (1, ?, ?, ?)').run(executionId, 1, document);
  } finally { connection.close(); }
}
/** Run only the installed executable with its ordinary command arguments. */
function invoke(args: readonly string[]) {
  return spawnSync(join(directory, 'node_modules/.bin/microdelta'), args, { cwd: directory, encoding: 'utf8', timeout: 10000 });
}
/** Finite refusals share one exit category and preserve their existing discriminant. */
function refusal(location: string, kind: string, id = executionId): void {
  const names = readdirSync(directory).sort();
  const result = invoke(['observe', '--location', location, '--execution-id', id]);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(`${JSON.stringify({ version: 1, result: { kind } })}\n`);
  expect(readdirSync(directory).sort()).toEqual(names);
}

test('the installed executable emits exactly one coherent observation without altering its artifact or application stores', () => {
  const location = join(directory, 'running.sqlite'); seed(location, sample());
  const files = ['running.sqlite', 'history.sqlite', 'accounting.sqlite', 'analysis.mjs'];
  const before = files.map(name => readFileSync(join(directory, name)));
  const names = readdirSync(directory).sort();
  const result = invoke(['observe', '--location', location, '--execution-id', executionId]);
  expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe(`${sample()}\n`);
  expect(files.map(name => readFileSync(join(directory, name)))).toEqual(before);
  expect(readdirSync(directory).sort()).toEqual(names);
});

test('a recorded execution failure is still a successful finite observation', () => {
  const location = join(directory, 'failed.sqlite'); seed(location, sample(true));
  const before = readFileSync(location);
  const result = invoke(['observe', '--execution-id', executionId, '--location', location]);
  expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).toBe(`${sample(true)}\n`);
  expect(readFileSync(location)).toEqual(before);
});

test('missing, mismatched, unsupported, corrupt and unavailable artifacts retain their exact refusal without initialization', () => {
  refusal(join(directory, 'absent.sqlite'), 'absent');
  const mismatched = join(directory, 'mismatch.sqlite'); seed(mismatched, sample());
  refusal(mismatched, 'identity-mismatch', 'b'.repeat(32));
  const future = join(directory, 'future.sqlite'); seed(future, JSON.stringify({ version: 2, result: {} }));
  refusal(future, 'unsupported');
  const corrupt = join(directory, 'corrupt.sqlite'); writeFileSync(corrupt, 'not a SQLite artifact');
  const before = readFileSync(corrupt); refusal(corrupt, 'corrupt'); expect(readFileSync(corrupt)).toEqual(before);
  // An existing directory is an unavailable file surface on every supported host;
  // this exercises the real reader without a CLI-only fault-injection option.
  refusal(directory, 'unavailable');
});

test('actual SQLite contention returns finite busy rather than waiting for the writer to finish', async () => {
  const location = join(directory, 'busy.sqlite'); seed(location, sample());
  const source = `import { createNodeSqlite } from '@microdelta/machine-node';
const connection = createNodeSqlite().openSqlite(process.argv[1], { journalMode: 'delete' });
connection.exec('BEGIN EXCLUSIVE');
process.stdin.once('data', () => { connection.exec('ROLLBACK'); connection.close(); });
process.stdout.write('ready');
setTimeout(() => process.exit(2), 5000).unref();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, location], { cwd: packageRoot, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve()); child.once('error', reject);
      child.once('exit', () => reject(new Error('writer exited before the contention barrier')));
    });
    const before = readFileSync(location); refusal(location, 'busy'); expect(readFileSync(location)).toEqual(before);
  } finally {
    child.stdin.end('release');
    await new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) { resolve(); } else { child.once('close', () => resolve()); } });
  }
});

test('invalid command arguments are rejected without JSON, reader side effects or author-module loading', () => {
  const location = join(directory, 'invalid-arguments-must-not-create.sqlite');
  const valid = ['observe', '--location', location, '--execution-id', executionId];
  for (const args of [[], ['run'], ['observe'], valid.slice(0, -1), ['observe', '--location', '', '--execution-id', executionId], ['observe', '--location', 'x'.repeat(4097), '--execution-id', executionId], ['observe', '--location', location, '--execution-id', 'A'.repeat(32)], [...valid, '--location', location], [...valid, '--analysis', join(directory, 'analysis.mjs')], [...valid, 'extra']]) {
    const names = readdirSync(directory).sort(); const result = invoke(args);
    expect(result.status).toBe(2); expect(result.stdout).toBe(''); expect(result.stderr).toMatch(/microdelta observe --location PATH --execution-id ID/u);
    expect(readdirSync(directory).sort()).toEqual(names);
  }
});
