/**
 * Consumer-facing native installation guidance must remain discoverable from
 * each onboarding path and keep its pinned reproduction reachable. These
 * checks enforce documentation links and scope markers, not platform support.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/** The repository root anchors links independently of a caller's working directory. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** This path is the single consumer guide for targeted native-build approval. */
const guide = 'docs/native-sqlite-install.md';
/** The immutable handoff fixture reproduces the published 0.2.0 consumer behavior. */
const fixture = 'scratch/gap-hunt/contract-operations/verify-157.sh';
/** The pinned fixture's digest prevents accidental changes to its tested controls. */
const pinnedDigest = 'b2becb9113b7ee62a2d984612000ce5c52299ec114eedece4de35eb370e7cfc7';

/** Read a checked-in path as UTF-8 so assertions inspect consumer-visible text. */
function content(path) { return readFileSync(resolve(root, path), 'utf8'); }

test('all three onboarding entry points link the native install guide', () => {
  for (const path of ['README.md', 'packages/core/README.md', 'examples/contribution-report/README.md']) {
    const markdown = content(path);
    const target = path === 'README.md' ? 'docs/native-sqlite-install.md' : '../../docs/native-sqlite-install.md';
    assert.ok(markdown.includes(`](${target})`), `${path} must link the guide`);
    assert.equal(resolve(dirname(resolve(root, path)), target), resolve(root, guide));
  }
});

test('the guide states the targeted approval workflow and negative controls', () => {
  const markdown = content(guide);
  for (const marker of ['microdelta@0.2.0', 'better-sqlite3', '10.34.7', '12.10.1', 'allowBuilds:', 'pnpm rebuild better-sqlite3', 'Ignored build scripts', 'ERR_PNPM_IGNORED_BUILDS']) {
    assert.ok(markdown.includes(marker), `guide must mention ${marker}`);
  }
  assert.match(markdown, /memory[\s\S]*project-private|project-private[\s\S]*memory/u);
  assert.match(markdown, /Linux[\s\S]*unverified|unverified[\s\S]*Linux/u);
  assert.match(markdown, /issues\/158/u);
});

test('the unchanged portable fixture remains available for platform-specific acceptance', () => {
  const source = content(fixture);
  const digest = createHash('sha256').update(source).digest('hex');
  assert.equal(digest, pinnedDigest);
  assert.match(content(guide), /verify-157\.sh/u);
});
