/** Installed start acceptance keeps module loading and argument grammar at the executable boundary. */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, test } from '@jest/globals';

const directory = mkdtempSync(join(tmpdir(), 'microdelta-start-bin-'));
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));

beforeAll(() => {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'start-cli-consumer', private: true, type: 'module' }));
  const installed = spawnSync('npm', ['install', '--prefix', directory, '--ignore-scripts', '--offline', '--package-lock=false', '--no-audit', '--no-fund', packageRoot], { encoding: 'utf8' });
  expect(installed.status).toBe(0);
  writeFileSync(join(directory, 'must-not-load.mjs'), "throw new Error('module loaded');\n");
  writeFileSync(join(directory, 'factory-fails.mjs'), `import { defineCliWorkload } from 'microdelta';\nexport default defineCliWorkload(() => { throw new Error('private failure'); });\n`);
});
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });

function invoke(args: readonly string[]) {
  return spawnSync(join(directory, 'node_modules/.bin/microdelta'), args, { cwd: directory, encoding: 'utf8', timeout: 10000 });
}

/** Extract one emitted JSON line without hiding an absent protocol record. */
function firstLine(text: string): string {
  const line = text.split('\n')[0];
  if (line === undefined || line.length === 0) { throw new Error('Expected a CLI receipt line'); }
  return line;
}

test('invalid tool flags fail before importing the caller module and emit no stdout', () => {
  for (const args of [
    ['start'],
    ['start', '--module', join(directory, 'must-not-load.mjs')],
    ['start', '--module', join(directory, 'must-not-load.mjs'), '--observation'],
    ['start', '--module', join(directory, 'must-not-load.mjs'), '--observation', join(directory, 'obs.sqlite'), '--module', 'again'],
    ['start', '--module', join(directory, 'must-not-load.mjs'), '--observation', join(directory, 'obs.sqlite'), '--bad'],
    ['start', '--module', '--unknown', '--observation', 'obs.sqlite'],
    ['start', '--module', 'must-not-load.ts', '--observation', 'obs.sqlite'],
  ]) {
    const result = invoke(args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: microdelta start');
  }
});

test('a loaded workload preparation failure is sanitized and cannot leak its thrown value', () => {
  const result = invoke(['start', '--module', join(directory, 'factory-fails.mjs'), '--observation', join(directory, 'observation.sqlite'), '--', 'opaque-secret']);
  expect(result.status).toBe(1);
  const lines = result.stdout.trimEnd().split('\n');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(firstLine(result.stdout))).toEqual({ version: 1, type: 'terminal', runtime: 'not-started', failures: ['preparation'], stop: 'none', cleanup: 'not-handed-over', transport: 'available' });
  expect(result.stderr).not.toContain('private failure');
  expect(result.stderr).not.toContain('opaque-secret');
});

test('the installed command emits an exact locator while a pending caller-owned body is still live', async () => {
  const workloadPath = join(directory, 'pending-workload.mjs');
  writeFileSync(workloadPath, `import { authoring, defineCliWorkload, openWorkspace } from 'microdelta';
export default defineCliWorkload((args) => {
  const workspace = openWorkspace({ location: args[0], logicalStore: 'cli-start-test' });
  const builders = authoring();
  const composition = builders.compose({ scope: 'cli-start-test', steps: [] });
  return { workspace, options: { authoring: builders, composition, environment: 'fixture' },
    body: () => new Promise((resolve) => { const timer = setTimeout(() => resolve('must-not-serialize'), 1000); timer.unref(); }),
    dispose: () => workspace.close() };
});\n`);
  const store = join(directory, 'start-history.sqlite');
  const child = spawn(join(directory, 'node_modules/.bin/microdelta'), ['start', '--module', workloadPath, '--observation', 'start-observation.sqlite', '--', store], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
      child.once('close', code => { if (code !== null && code !== 0) { reject(new Error(`start exited early (${code}): ${stderr}`)); } });
    });
    const locator = JSON.parse(firstLine(stdout)) as { readonly locator: { readonly location: string; readonly executionId: string } };
    expect(locator.locator.location).toBe(join(realpathSync(directory), 'start-observation.sqlite'));
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    const read = spawnSync(join(directory, 'node_modules/.bin/microdelta'), ['observe', '--location', locator.locator.location, '--execution-id', locator.locator.executionId], { cwd: tmpdir(), encoding: 'utf8' });
    expect(read.status).toBe(0);
    const observed = JSON.parse(read.stdout) as { readonly result: { readonly observation: { readonly phase: string } } };
    expect(['prepared', 'running']).toContain(observed.result.observation.phase);
    const status = await new Promise<number | null>(resolve => child.once('close', resolve));
    expect(status).toBe(0);
    expect(stderr).toBe('');
    const records: unknown[] = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as unknown);
    expect(records).toHaveLength(2);
    expect(records[1]).toEqual(expect.objectContaining({ type: 'terminal', runtime: 'returned', acknowledgment: expect.objectContaining({ kind: 'acknowledged' }), cleanup: 'disposed' }));
    expect(stdout).not.toContain('must-not-serialize');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise<void>(resolve => child.once('close', () => resolve())); }
  }
});

test('first SIGINT requests soft stop and the command exits only after body drain and disposal', async () => {
  const workloadPath = join(directory, 'interrupt-workload.mjs');
  writeFileSync(workloadPath, `import { authoring, defineCliWorkload, openWorkspace } from 'microdelta';
export default defineCliWorkload((args) => {
  const workspace = openWorkspace({ location: args[0], logicalStore: 'cli-interrupt-test' });
  const builders = authoring();
  const composition = builders.compose({ scope: 'cli-interrupt-test', steps: [] });
  return { workspace, options: { authoring: builders, composition, environment: 'fixture' },
    body: () => new Promise((resolve) => { const timer = setTimeout(() => resolve('done'), 250); timer.unref(); }),
    dispose: () => workspace.close() };
});\n`);
  const child = spawn(join(directory, 'node_modules/.bin/microdelta'), ['start', '--module', workloadPath, '--observation', join(directory, 'interrupt-observation.sqlite'), '--', join(directory, 'interrupt-history.sqlite')], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { stdout += chunk; });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); });
    const signalAt = Date.now();
    child.kill('SIGINT');
    const status = await new Promise<number | null>(resolve => child.once('close', resolve));
    expect(status).toBe(130);
    expect(Date.now() - signalAt).toBeGreaterThanOrEqual(150);
    const receipts: unknown[] = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as unknown);
    expect(receipts).toHaveLength(2);
    expect(receipts[1]).toEqual(expect.objectContaining({ type: 'terminal', runtime: 'returned', stop: 'soft', cleanup: 'disposed' }));
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise<void>(resolve => child.once('close', () => resolve())); }
  }
});


/** Trusted JavaScript fixtures inject independent runtime and acknowledgment outcomes without provider work. */
function fixture(name: string, preparation: string): string {
  const path = join(directory, `${name}.mjs`);
  writeFileSync(path, `import { defineCliWorkload } from 'microdelta';
import { appendFileSync } from 'node:fs';
const mark = (value) => appendFileSync(${JSON.stringify(join(directory, `${name}.log`))}, value + '\\n');
export default defineCliWorkload(async (args) => { ${preparation} });\n`);
  return path;
}

/** Decode fixed protocol records; author results intentionally have no corresponding field. */
function receipts(stdout: string): readonly unknown[] {
  return stdout.trimEnd().split('\n').map(line => JSON.parse(line) as unknown);
}

test.each(['result-first', 'ack-first'] as const)('independent %s rejection retains both settlements before exactly-once failing disposal', order => {
  const path = fixture(order, `
  const later = (callback) => new Promise((resolve, reject) => setTimeout(() => { mark('settled'); callback(resolve, reject); }, 70));
  return { workspace: { startObserved() { mark('start'); return {
    locator: { location: ${JSON.stringify(join(directory, `${order}.sqlite`))}, executionId: 'a'.repeat(32) },
    result: ${order === 'result-first' ? "Promise.reject({ secret: 'private-result' })" : "later((resolve, reject) => reject({ secret: 'private-result' }))"},
    acknowledgment: ${order === 'ack-first' ? "Promise.reject({ secret: 'private-ack' })" : "later((resolve, reject) => reject({ secret: 'private-ack' }))"}
  }; } }, options: {}, body() {}, dispose() { mark('dispose'); throw { secret: 'private-cleanup' }; } };`);
  const result = invoke(['start', '--module', path, '--observation', `${order}.sqlite`]);
  expect(result.status).toBe(1);
  expect(readFileSync(join(directory, `${order}.log`), 'utf8')).toBe('start\nsettled\ndispose\n');
  expect(receipts(result.stdout)[1]).toEqual(expect.objectContaining({ runtime: 'failed', acknowledgment: { kind: 'rejected' }, cleanup: 'failed', failures: ['runtime', 'observation', 'cleanup'] }));
  expect(result.stdout + result.stderr).not.toContain('private-');
});

test('synchronous refusal disposes the handed-over preparation exactly once without inventing a locator', () => {
  const path = fixture('sync-refusal', `return { workspace: { startObserved() { mark('start'); throw new Error('private-refusal'); } }, options: {}, body() {}, dispose() { mark('dispose'); } };`);
  const result = invoke(['start', '--module', path, '--observation', 'refusal.sqlite']);
  expect(result.status).toBe(1);
  expect(readFileSync(join(directory, 'sync-refusal.log'), 'utf8')).toBe('start\ndispose\n');
  expect(receipts(result.stdout)).toEqual([expect.objectContaining({ runtime: 'not-started', cleanup: 'disposed', failures: ['runtime'] })]);
  expect(result.stdout + result.stderr).not.toContain('private-refusal');
});

test.each(['uncertain', 'unprepared'] as const)('%s acknowledgment never retries a fulfilled runtime', kind => {
  const path = fixture(kind, `return { workspace: { startObserved() { mark('start'); return { locator: { location: ${JSON.stringify(join(directory, `${kind}.sqlite`))}, executionId: 'b'.repeat(32) }, result: Promise.resolve({ cyclic: null }), acknowledgment: Promise.resolve({ kind: '${kind}' }) }; } }, options: {}, body() {}, dispose() { mark('dispose'); } };`);
  const result = invoke(['start', '--module', path, '--observation', `${kind}.sqlite`]);
  expect(result.status).toBe(1);
  expect(readFileSync(join(directory, `${kind}.log`), 'utf8')).toBe('start\ndispose\n');
  expect(receipts(result.stdout)[1]).toEqual(expect.objectContaining({ runtime: 'returned', acknowledgment: { kind }, cleanup: 'disposed', failures: ['observation'] }));
});

test.each(['wrong-export', 'import-failure', 'invalid-preparation'] as const)('%s is a sanitized invalid module contract', kind => {
  const path = join(directory, `${kind}.mjs`);
  writeFileSync(path, kind === 'wrong-export' ? `export default { prepare() { throw 'private-body'; } };` : kind === 'import-failure' ? `throw 'private-import';` : `import { defineCliWorkload } from 'microdelta'; export default defineCliWorkload(() => ({ body() { throw 'private-body'; } }));`);
  const result = invoke(['start', '--module', path, '--observation', `${kind}.sqlite`]);
  expect(result.status).toBe(2);
  expect(receipts(result.stdout)).toEqual([expect.objectContaining({ runtime: 'not-started', cleanup: 'not-handed-over', failures: ['module'] })]);
  expect(result.stdout + result.stderr).not.toContain('private-');
});


/** Capture process completion before any signal or output can race with listener installation. */
function launch(path: string, observation: string) {
  const child = spawn(join(directory, 'node_modules/.bin/microdelta'), ['start', '--module', path, '--observation', observation], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise<number | null>((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  return { child, closed, output: () => ({ stdout, stderr }) };
}

/** Readiness is an explicit caller diagnostic; no timing assumption substitutes for module/preparation entry. */
async function ready(process: ReturnType<typeof launch>, stream: 'stdout' | 'stderr'): Promise<void> {
  if (process.output()[stream].length > 0) { return; }
  await Promise.race([new Promise<void>(resolve => process.child[stream].once('data', () => resolve())), process.closed.then(() => { throw new Error('Fixture closed before readiness'); })]);
}

/** Bound failed assertions without leaving a deliberately pending child alive in the test runner. */
async function finish(process: ReturnType<typeof launch>): Promise<void> {
  if (process.child.exitCode === null && process.child.signalCode === null) { process.child.kill('SIGKILL'); await process.closed; }
}

test.each(['second-SIGINT', 'SIGTERM'] as const)('%s reaches the actual observed run hard-stop controller', async kind => {
  const path = fixture(kind, `return { workspace: { startObserved(options) { mark('start'); return {
    locator: { location: ${JSON.stringify(join(directory, `${kind}.sqlite`))}, executionId: 'c'.repeat(32) },
    result: new Promise((resolve) => { options.stop.subscribe(state => { mark(state.level); if (state.level === 'hard') { setTimeout(() => { mark('drained'); resolve({}); }, 50).unref(); } }); }),
    acknowledgment: Promise.resolve({ kind: 'acknowledged', revision: 1 })
  }; } }, options: {}, body() {}, dispose() { mark('dispose'); } };`);
  const process = launch(path, `${kind}.sqlite`);
  try {
    await ready(process, 'stdout');
    process.child.kill(kind === 'SIGTERM' ? 'SIGTERM' : 'SIGINT');
    if (kind === 'second-SIGINT') { await new Promise<void>(resolve => setTimeout(resolve, 40)); process.child.kill('SIGINT'); }
    expect(await process.closed).toBe(kind === 'SIGTERM' ? 143 : 130);
    expect(readFileSync(join(directory, `${kind}.log`), 'utf8')).toBe(kind === 'SIGTERM' ? 'start\nhard\ndrained\ndispose\n' : 'start\nsoft\nhard\ndrained\ndispose\n');
    expect(receipts(process.output().stdout)[1]).toEqual(expect.objectContaining({ runtime: 'returned', stop: 'hard', cleanup: 'disposed' }));
  } finally { await finish(process); }
});

test.each(['SIGINT', 'SIGTERM'] as const)('%s during pending preparation starts zero runs and disposes once after handover', async signal => {
  const path = fixture(`setup-${signal}`, `process.stderr.write('preparing\\n'); await new Promise(resolve => setTimeout(resolve, 100).unref());
  return { workspace: { startObserved() { mark('unexpected-start'); throw 1; } }, options: {}, body() {}, dispose() { mark('dispose'); } };`);
  const process = launch(path, `setup-${signal}.sqlite`);
  try {
    await ready(process, 'stderr'); process.child.kill(signal);
    expect(await process.closed).toBe(signal === 'SIGINT' ? 130 : 143);
    expect(readFileSync(join(directory, `setup-${signal}.log`), 'utf8')).toBe('dispose\n');
    expect(receipts(process.output().stdout)).toEqual([expect.objectContaining({ runtime: 'not-started', cleanup: 'disposed', failures: [] })]);
  } finally { await finish(process); }
});

test.each(['locator', 'terminal'] as const)('a failed %s stdout write retains drain, acknowledgment and disposal duties', async stage => {
  const path = fixture(`pipe-${stage}`, `${stage === 'locator' ? "process.stderr.write('preparing\\n'); await new Promise(resolve => setTimeout(resolve, 100));" : ''}
  return { workspace: { startObserved() { mark('start'); return {
    locator: { location: ${JSON.stringify(join(directory, `pipe-${stage}.sqlite`))}, executionId: 'd'.repeat(32) },
    result: new Promise(resolve => setTimeout(() => { mark('result'); resolve({}); }, 100).unref()),
    acknowledgment: new Promise(resolve => setTimeout(() => { mark('ack'); resolve({ kind: 'acknowledged', revision: 1 }); }, 150).unref())
  }; } }, options: {}, body() {}, dispose() { mark('dispose'); } };`);
  const process = launch(path, `pipe-${stage}.sqlite`);
  try {
    await ready(process, stage === 'locator' ? 'stderr' : 'stdout');
    process.child.stdout.destroy();
    expect(await process.closed).toBe(1);
    expect(readFileSync(join(directory, `pipe-${stage}.log`), 'utf8')).toBe('start\nresult\nack\ndispose\n');
    expect(process.output().stderr).not.toContain('EPIPE');
  } finally { await finish(process); }
});

test('cyclic and huge author results and thrown values cannot grow or leak into command receipts', () => {
  for (const rejects of [false, true]) {
    const name = `private-${String(rejects)}`;
    const path = fixture(name, `const secret = { value: 'PRIVATE'.repeat(100000) }; secret.self = secret;
    return { workspace: { startObserved() { return { locator: { location: ${JSON.stringify(join(directory, `${name}.sqlite`))}, executionId: 'e'.repeat(32) }, result: Promise.${rejects ? 'reject' : 'resolve'}(secret), acknowledgment: Promise.resolve({ kind: 'acknowledged', revision: 1 }) }; } }, options: {}, body() {}, dispose() {} };`);
    const result = invoke(['start', '--module', path, '--observation', `${name}.sqlite`]);
    expect(result.status).toBe(rejects ? 1 : 0);
    expect(result.stdout.length).toBeLessThan(1000);
    expect(result.stdout + result.stderr).not.toContain('PRIVATE');
  }
});

test('a strict generated-alpha consumer compiles, runs through the installed CLI and reuses exact source results across processes', () => {
  const repository = fileURLToPath(new URL('../../../../../', import.meta.url));
  const alphaPaths = Object.fromEntries(['core', 'accounting', 'definition', 'history', 'machine', 'machine-node', 'materialization', 'resolution', 'supervision', 'tracking', 'value'].map(name => [name === 'core' ? 'microdelta' : `@microdelta/${name}`, [join(repository, 'packages', name, 'dist/api', `${name === 'core' ? 'microdelta' : name}.alpha.d.ts`)]]));
  const source = `import { appendFileSync } from 'node:fs';
import { authoring, defineCliWorkload, openWorkspace } from 'microdelta';
interface IInputs { readonly config: { readonly value: string }; }
interface IHelpers { readonly acquired: () => void; }
export default defineCliWorkload(async args => {
  const [location, evidence, , requestKey] = args;
  if (!Object.isFrozen(args) || location === undefined || evidence === undefined || requestKey === undefined || args[2] !== '--opaque-secret') { throw new Error('Invalid caller arguments'); }
  const mark = (value: string): void => { appendFileSync(evidence, value + '\\n'); };
  mark('factory');
  const builders = authoring<IInputs, IHelpers>();
  const source = builders.source<{ readonly value: string }>({ subject: 'retained', run: ({ previous, outcome, inputs, helpers }) => {
    if (previous !== undefined) { return outcome.retain(previous); }
    helpers.acquired(); return outcome.fresh({ value: inputs.config.value });
  } });
  const composition = builders.compose({ scope: 'cli-consumer', inputs: [{ slot: 'config', value: { value: 'useful' } }], helpers: [{ slot: 'acquired', helper: () => mark('acquired') }], steps: [{ slot: 'data', declaration: source }] });
  const workspace = openWorkspace({ location, logicalStore: 'cli-consumer' });
  return { workspace, options: { authoring: builders, composition, environment: 'fixture' },
    async body(run, application) {
      mark('body');
      const result = await run.resolve({ scope: 'cli-consumer', role: 'step', slot: 'data' }, { requestKey });
      if (result.kind !== 'published' && result.kind !== 'reused') { throw new Error('Expected a retained result'); }
      mark(result.kind);
      mark(JSON.stringify({ reference: result.reference, data: run.read(result.reference) }));
      application.submit({ kind: 'incomplete', reasons: ['coverage'] });
      return { privateResult: 'never-serialize' };
    }, dispose() { mark('dispose'); workspace.close(); } };
});\n`;
  writeFileSync(join(directory, 'consumer.ts'), source);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmitOnError: true, skipLibCheck: false, types: ['node'], typeRoots: [join(repository, 'node_modules/@types')], paths: alphaPaths, outDir: './compiled' }, files: ['consumer.ts'] }));
  const compiled = spawnSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', join(directory, 'tsconfig.json')], { cwd: directory, encoding: 'utf8' });
  expect(compiled.stdout + compiled.stderr).toBe(''); expect(compiled.status).toBe(0);
  const evidence = join(directory, 'consumer.log');
  const history = join(directory, 'consumer.sqlite');
  const results = [0, 1].map(index => invoke(['start', '--module', 'compiled/consumer.js', '--observation', `consumer-${String(index)}.sqlite`, '--', history, evidence, '--opaque-secret', `request-${String(index)}`]));
  for (const result of results) { expect(result.stderr).toBe(''); if (result.status !== 0) { throw new Error(result.stdout + readFileSync(evidence, 'utf8')); } expect(result.stdout).not.toContain('never-serialize'); }
  const lines = readFileSync(evidence, 'utf8').trimEnd().split('\n');
  expect(lines.filter(line => line === 'factory')).toHaveLength(2); expect(lines.filter(line => line === 'body')).toHaveLength(2);
  expect(lines.filter(line => line === 'published')).toHaveLength(1); expect(lines.filter(line => line === 'reused')).toHaveLength(1);
  expect(lines.filter(line => line === 'acquired')).toHaveLength(1); expect(lines.filter(line => line === 'dispose')).toHaveLength(2);
  const data = lines.filter(line => line.startsWith('{'));
  expect(data).toHaveLength(2); expect(data[0]).toBe(data[1]); expect(data[0]).toContain('useful');
  const locator = JSON.parse(firstLine(results[0]?.stdout ?? '')) as { readonly locator: { readonly location: string; readonly executionId: string } };
  const read = invoke(['observe', '--location', locator.locator.location, '--execution-id', locator.locator.executionId]);
  expect(read.status).toBe(0); expect(read.stdout).toContain('"kind":"incomplete"');
});


test('a rejected real body cannot dispose while an admitted source remains tracked and draining', () => {
  const path = fixture('tracked-drain', `const { authoring, openWorkspace } = await import('microdelta');
  const workspace = openWorkspace({ location: ${JSON.stringify(join(directory, 'tracked-history.sqlite'))}, logicalStore: 'tracked-drain' });
  let announce; const entered = new Promise(resolve => { announce = resolve; });
  const builders = authoring();
  const source = builders.source({ subject: 'delayed', async run({ outcome }) { mark('source-entered'); announce(); await new Promise(resolve => setTimeout(resolve, 70).unref()); mark('source-drained'); return outcome.fresh({ useful: true }); } });
  const composition = builders.compose({ scope: 'tracked-drain', steps: [{ slot: 'source', declaration: source }] });
  return { workspace, options: { authoring: builders, composition, environment: 'fixture' },
    async body(run) { void run.resolve({ scope: 'tracked-drain', role: 'step', slot: 'source' }, { requestKey: 'first' }).catch(() => undefined); await entered; throw { secret: 'private-body' }; },
    dispose() { mark('dispose'); workspace.close(); } };`);
  const result = invoke(['start', '--module', path, '--observation', 'tracked-observation.sqlite']);
  expect(result.status).toBe(1);
  expect(readFileSync(join(directory, 'tracked-drain.log'), 'utf8')).toBe('source-entered\nsource-drained\ndispose\n');
  expect(receipts(result.stdout)[1]).toEqual(expect.objectContaining({ runtime: 'failed', acknowledgment: expect.objectContaining({ kind: 'acknowledged' }), cleanup: 'disposed', failures: ['runtime'] }));
  expect(result.stdout + result.stderr).not.toContain('private-body');
});

test('an observation preparation failure starts zero real bodies and preserves an existing file byte for byte', () => {
  const occupied = join(directory, 'occupied-observation.sqlite');
  const bytes = 'existing caller-owned artifact'; writeFileSync(occupied, bytes);
  const path = fixture('store-refusal', `const { authoring, openWorkspace } = await import('microdelta');
  const workspace = openWorkspace({ location: ${JSON.stringify(join(directory, 'refused-history.sqlite'))}, logicalStore: 'store-refusal' });
  const builders = authoring(); const composition = builders.compose({ scope: 'store-refusal', steps: [] });
  return { workspace, options: { authoring: builders, composition, environment: 'fixture' }, body() { mark('unexpected-body'); }, dispose() { mark('dispose'); workspace.close(); } };`);
  const result = invoke(['start', '--module', path, '--observation', occupied]);
  expect(result.status).toBe(1);
  expect(readFileSync(occupied, 'utf8')).toBe(bytes);
  expect(readFileSync(join(directory, 'store-refusal.log'), 'utf8')).toBe('dispose\n');
  expect(receipts(result.stdout)[1]).toEqual(expect.objectContaining({ runtime: 'failed', acknowledgment: { kind: 'unprepared' }, cleanup: 'disposed', failures: ['runtime', 'observation'] }));
});

test('a fresh invocation refuses an already occupied observation path without a second body or overwrite', () => {
  const path = fixture('path-collision', `const { authoring, openWorkspace } = await import('microdelta');
  const workspace = openWorkspace({ location: ${JSON.stringify(join(directory, 'collision-history.sqlite'))}, logicalStore: 'path-collision' });
  const builders = authoring(); const composition = builders.compose({ scope: 'path-collision', steps: [] });
  return { workspace, options: { authoring: builders, composition, environment: 'fixture' }, body() { mark('body'); }, dispose() { mark('dispose'); workspace.close(); } };`);
  const observation = join(directory, 'collision-observation.sqlite');
  const first = invoke(['start', '--module', path, '--observation', observation]);
  expect(first.status).toBe(0);
  const original = readFileSync(observation);
  const second = invoke(['start', '--module', path, '--observation', observation]);
  expect(second.status).toBe(1); expect(readFileSync(observation)).toEqual(original);
  expect(readFileSync(join(directory, 'path-collision.log'), 'utf8')).toBe('body\ndispose\ndispose\n');
  const locator = JSON.parse(firstLine(first.stdout)) as { readonly locator: { readonly location: string; readonly executionId: string } };
  const read = invoke(['observe', '--location', locator.locator.location, '--execution-id', locator.locator.executionId]);
  expect(read.status).toBe(0); expect(read.stdout).toContain('"phase":"closed"');
  expect(receipts(second.stdout)[1]).toEqual(expect.objectContaining({ runtime: 'failed', acknowledgment: { kind: 'unprepared' }, cleanup: 'disposed' }));
});


test('an installed CLI accepts the typed workload helper from a compatible second physical package copy', () => {
  const second = join(directory, 'second-consumer');
  const copied = join(second, 'node_modules/microdelta');
  mkdirSync(join(copied, 'dist'), { recursive: true });
  cpSync(join(packageRoot, 'dist/src'), join(copied, 'dist/src'), { recursive: true });
  cpSync(join(packageRoot, 'package.json'), join(copied, 'package.json'));
  symlinkSync(join(packageRoot, '../../node_modules/@microdelta'), join(second, 'node_modules/@microdelta'), 'dir');
  const workload = join(second, 'workload.mjs');
  const evidence = join(second, 'handover.log');
  writeFileSync(workload, `import { appendFileSync } from 'node:fs';
import { authoring, defineCliWorkload, openWorkspace } from 'microdelta';
export default defineCliWorkload(() => {
  const mark = value => appendFileSync(${JSON.stringify(evidence)}, value + '\\n');
  mark('factory');
  const builders = authoring(); const composition = builders.compose({ scope: 'second-copy', steps: [] });
  const workspace = openWorkspace({ location: ${JSON.stringify(join(second, 'history.sqlite'))}, logicalStore: 'second-copy' });
  return { workspace, options: { authoring: builders, composition, environment: 'fixture' }, body() { mark('body'); }, dispose() { mark('dispose'); workspace.close(); } };
});\n`);
  const result = invoke(['start', '--module', workload, '--observation', join(second, 'observation.sqlite')]);
  expect(result.status).toBe(0); expect(result.stderr).toBe('');
  expect(readFileSync(evidence, 'utf8')).toBe('factory\nbody\ndispose\n');
  expect(receipts(result.stdout)[1]).toEqual(expect.objectContaining({ runtime: 'returned', cleanup: 'disposed', acknowledgment: expect.objectContaining({ kind: 'acknowledged' }) }));
});


test.each(['false-marker', 'noncallable-factory'] as const)('a %s default is refused before factory execution', kind => {
  const path = join(directory, `${kind}.mjs`);
  writeFileSync(path, `export default { [Symbol.for('microdelta.cli-workload')]: ${kind === 'false-marker' ? 'false' : 'true'}, prepare: ${kind === 'false-marker' ? "() => { process.stderr.write('unexpected-factory'); }" : '42'} };`);
  const result = invoke(['start', '--module', path, '--observation', `${kind}.sqlite`]);
  expect(result.status).toBe(2); expect(result.stderr).toBe('');
  expect(receipts(result.stdout)).toEqual([expect.objectContaining({ runtime: 'not-started', cleanup: 'not-handed-over', failures: ['module'] })]);
});
