/** Documentation pickup oracle: consumer-visible alias scope, not new runtime policy. */
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

/** Existing entrypoints must directly state the boundary or link its shared guide. */
const entrypoints = ['README.md', 'packages/core/README.md', 'examples/contribution-report/README.md'];
const read = path => readFileSync(path, 'utf8');
/** Check ideas independently of heading/spelling choices; this remains a prose presence check. */
function hasGuidance(text) {
  return /absolute/iu.test(text) && /relative/iu.test(text) && /redundant/iu.test(text)
    && /symbolic|symlink/iu.test(text) && /hard[ -]?link/iu.test(text)
    && /distinct|different (?:canonical )?(?:names|paths)/iu.test(text)
    && /WAL|write-ahead/iu.test(text) && /journal|sidecar/iu.test(text)
    && /unsafe|must not|do not.*concurrent|not supported/isu.test(text);
}
/** Direct local Markdown links keep native guidance discoverable before opening a store. */
function linkedDocuments(path) {
  return [...read(path).matchAll(/\[[^\]]*\]\(([^)#]+\.md)(?:#[^)]*)?\)/gu)]
    .map(match => resolve(dirname(path), match[1]))
    .filter(target => existsSync(target));
}
for (const entry of entrypoints) {
  test(`${entry} exposes supported path spellings and the hard-link/WAL restriction`, () => {
    assert.ok([entry, ...linkedDocuments(entry)].some(path => hasGuidance(read(path))), `${entry} needs directly stated or linked native alias guidance: absolute/relative/redundant/symbolic spellings; distinct hard-linked names; unsafe concurrent WAL/journal access`);
  });
}
/** Return only the owning comment immediately preceding the actual declaration. */
function owningComment(path, declaration) {
  const text = read(path);
  const offset = text.indexOf(declaration);
  assert.ok(offset >= 0, `missing declaration ${declaration}`);
  const start = text.lastIndexOf('/**', offset);
  const end = text.indexOf('*/', start);
  assert.ok(start >= 0 && end >= start && end < offset);
  return text.slice(start, end + 2);
}
for (const [path, declaration] of [
  ['packages/machine-node/src/index.ts', 'export function canonicalNodeLocation('],
  ['packages/core/src/workspace.ts', 'const store = canonicalNodeLocation('],
]) {
  test(`${path} narrows its owning canonical-location comment`, () => {
    const comment = owningComment(path, declaration);
    assert.ok(/symbolic|symlink/iu.test(comment), 'name the supported symbolic-path scope');
    assert.ok(/hard[ -]?link/iu.test(comment) && /distinct|not|exclude|unsupported/iu.test(comment), 'explicitly exclude same-identity inference for hard-linked names');
    assert.ok(!/however the caller spelled|two spellings\s+of one file compare equal/iu.test(comment), 'remove unqualified same-file spelling equivalence');
  });
}
