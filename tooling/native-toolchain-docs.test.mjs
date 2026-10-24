/**
 * Native SQLite guidance has one consumer route and a pinned diagnostic. These
 * checks preserve discoverability and evidence boundaries; they do not turn a
 * host-specific native build into a platform support guarantee.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/** Repository-relative links are resolved from this file, not the caller's cwd. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The guide owns platform-qualified native installation advice. */
const guide = 'docs/native-sqlite-toolchain.md';
/** This pinned diagnostic reports child outcomes rather than expecting failure. */
const diagnostic = 'scratch/gap-hunt/contract-operations/diagnose-158-native.mjs';
/** Digest of the reviewed disposable diagnostic at gap-hunt-durability@faa7d25. */
const diagnosticDigest = '05062901824f478b0ca4a25b6c1f2ce101cd76e2f8c0b9169a3d4012b97953a4';

/** Checked-in text is the consumer-visible material these assertions protect. */
function content(path) { return readFileSync(resolve(root, path), 'utf8'); }

test('root and facade onboarding resolve to the native toolchain guide', () => {
  for (const [path, target] of [
    ['README.md', 'docs/native-sqlite-toolchain.md'],
    ['packages/core/README.md', '../../docs/native-sqlite-toolchain.md'],
  ]) {
    assert.ok(content(path).includes(`](${target})`), `${path} must link the guide`);
    assert.equal(resolve(dirname(resolve(root, path)), target), resolve(root, guide));
  }
});

test('guide separates the three macOS observations and gives only command-local repair', () => {
  const text = content(guide);
  for (const marker of [
    'Node 26.12.0', 'HTTP 200', 'tapi error: malformed file',
    'unknown architecture', 'stdio.h not found', 'DEVELOPER_DIR', 'CC=',
    'CXX=', 'SDKROOT=', 'CFLAGS=', 'CXXFLAGS=', 'LDFLAGS=',
  ]) assert.ok(text.includes(marker), `guide must mention ${marker}`);
  assert.match(text, /xcode-select[\s\S]*global|global[\s\S]*xcode-select/u);
});

test('guide attributes Linux npm proof and keeps package metadata separate', () => {
  const text = content(guide);
  for (const marker of [
    'c5802daca4a0bb8ea91159854d84eddcfa5215b6', 'Node 24.13.0',
    'Node 26.12.1', 'npm ci', 'npm run build', 'npm test',
    'owner-supplied', 'pnpm', 'same-store', '20.x || 22.x || 23.x || 24.x || 25.x',
    'public memory', 'node:sqlite', '#157',
  ]) assert.ok(text.includes(marker), `guide must mention ${marker}`);
});

test('diagnostic remains the unchanged disposable, outcome-recording fixture', () => {
  const source = content(diagnostic);
  assert.equal(createHash('sha256').update(source).digest('hex'), diagnosticDigest);
  assert.match(source, /install\.status===0/u);
  assert.match(source, /smoke=capture/u);
  assert.match(content(guide), /diagnose-158-native\.mjs/u);
});

test('current host probe records its Node 24 adaptation and child results', () => {
  const evidence = content('docs/validation/native-sqlite-toolchain-2026-10-23.md');
  assert.match(evidence, /Node 24\.14\.0[\s\S]*Darwin arm64/u);
  assert.match(evidence, /version guard[\s\S]*26[\s\S]*24/u);
  assert.match(evidence, /install\.status.*0[\s\S]*smoke\.status.*0/u);
  assert.match(evidence, /not a Node 26 test/u);
});
