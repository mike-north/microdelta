/** Execute the unchanged diagnostic with synthetic host/child ports; no native install is performed. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const source = readFileSync(new URL('../contract-operations/diagnose-158-native.mjs', import.meta.url), 'utf8');
const child = (status, stdout = '', stderr = '', signal = null, error = undefined) => ({ status, stdout, stderr, signal, error });
async function diagnose(install, smoke, version = '26.12.0') {
  const calls = []; const removed = []; const output = [];
  const context = createContext({ process: { version: `v${version}`, versions: { node: version, modules: '147' }, platform: 'synthetic', arch: 'test', execPath: 'synthetic-node' }, console: { log: text => output.push(text) } });
  const ports = {
    'node:child_process': { spawnSync: (...args) => { calls.push(args); return calls.length === 1 ? child(0, 'synthetic-npm') : calls.length === 2 ? install : smoke; } },
    'node:fs': { mkdtempSync: () => '/synthetic/probe', writeFileSync: () => {}, rmSync: (...args) => removed.push(args) },
    'node:os': { tmpdir: () => '/synthetic', homedir: () => '/synthetic/home' },
    'node:path': { join },
  };
  const module = new SourceTextModule(source, { context });
  await module.link(specifier => {
    const values = ports[specifier]; assert.ok(values, specifier);
    return new SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context });
  });
  await module.evaluate({ timeout: 1000 });
  assert.equal(removed.length, 1); assert.equal(removed[0][0], '/synthetic/probe');
  return { result: JSON.parse(output[0]), calls };
}

test('install failure remains a diagnostic observation and never runs smoke', async () => {
  const { result, calls } = await diagnose(child(1, '', 'synthetic linker failure'));
  assert.equal(result.install.status, 1); assert.equal(result.smoke, null); assert.equal(calls.length, 2);
});
test('successful install/open remains valid and retains the smoke marker', async () => {
  const { result, calls } = await diagnose(child(0), child(0, 'native-sqlite-open-query-ok\n'));
  assert.equal(result.install.status, 0); assert.equal(result.smoke.status, 0); assert.match(result.smoke.stdout, /native-sqlite-open-query-ok/u); assert.equal(calls.length, 3);
});
test('failed native open remains visibly failed despite diagnostic completion', async () => {
  const { result } = await diagnose(child(0), child(1, '', 'synthetic binding failure'));
  assert.equal(result.smoke.status, 1); assert.match(result.smoke.stderr, /binding failure/u);
});
test('infrastructure error/signal remains visible without fabricated smoke success', async () => {
  const { result } = await diagnose(child(null, '', '', 'SIGTERM', new Error('synthetic child error')));
  assert.equal(result.install.status, null); assert.equal(result.install.signal, 'SIGTERM'); assert.equal(result.install.error, 'synthetic child error'); assert.equal(result.smoke, null);
});
test('unselected Node version rejects before child execution', async () => {
  await assert.rejects(diagnose(child(0), child(0), '24.22.1'), /Select Node26/u);
});
