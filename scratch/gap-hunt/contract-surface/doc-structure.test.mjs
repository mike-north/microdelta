/** Executable SPEC-5 / reconciliation artifact checks, without runtime claims. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
const files = ['docs/spec/README.md', 'docs/spec/domain.md', 'docs/spec/architecture.md', 'docs/spec/package-boundaries.md', 'docs/spec/experiments.md', 'docs/spec/reconciliation.md', 'docs/spec/validation.md', 'README.md', 'packages/core/README.md', 'examples/contribution-report/README.md'];
function withoutFences(source) { return source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gmu, ''); }
function anchors(source) {
  const found = new Set();
  const occurrences = new Map();
  for (const match of source.matchAll(/^#{1,6}\s+(.+)$/gmu)) {
    const slug = match[1].toLowerCase().replace(/<[^>]*>/gu, '').replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /gu, '-');
    const count = occurrences.get(slug) ?? 0;
    found.add(count === 0 ? slug : `${slug}-${count}`);
    occurrences.set(slug, count + 1);
  }
  for (const match of source.matchAll(/<(?:a|[a-z]+)[^>]*\bid=["']([^"']+)["']/gu)) found.add(match[1]);
  return found;
}
test('selected current spec/README links point to existing local targets and anchors', () => {
  const failures = [];
  for (const file of files) {
    const source = withoutFences(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|go\/)/u.test(href)) continue;
      const [target, fragment] = href.split('#');
      const path = target === '' ? resolve(file) : resolve(dirname(file), decodeURIComponent(target));
      if (!existsSync(path)) { failures.push(`${file}: missing ${href}`); continue; }
      if (fragment === undefined || fragment === '') continue;
      const content = readFileSync(path, 'utf8');
      if (/^L\d+(?:-L\d+)?$/u.test(fragment)) {
        const bounds = [...fragment.matchAll(/\d+/gu)].map(value => Number(value[0]));
        if (bounds.some(line => line < 1 || line > content.split('\n').length)) failures.push(`${file}: out-of-range ${href}`);
      } else if (!anchors(content).has(decodeURIComponent(fragment))) failures.push(`${file}: absent anchor ${href}`);
    }
  }
  assert.deepEqual(failures, []);
});
test('reconciliation source map resolves every recorded active artifact', () => {
  const rows = readFileSync('docs/spec/artifacts/source-map.csv', 'utf8').trim().split('\n').slice(1);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const target = row.split(',')[1];
    assert.ok(target !== undefined && existsSync(resolve('docs/spec', target)), `Missing source-map target ${target}`);
  }
});
test('restart scenario artifact is parseable and keeps distinct explicit outcomes', () => {
  const fixture = JSON.parse(readFileSync('docs/spec/artifacts/reuse-cases.json', 'utf8'));
  assert.equal(typeof fixture, 'object');
  assert.notEqual(fixture, null);
  assert.equal(fixture.status, 'specified-not-executed');
  assert.ok(Array.isArray(fixture.cases));
  const identities = new Set();
  for (const entry of fixture.cases) {
    assert.equal(typeof entry.id, 'string');
    assert.ok(!identities.has(entry.id), `Duplicate case ${entry.id}`);
    identities.add(entry.id);
    assert.equal(typeof entry.expected, 'object');
    assert.notEqual(entry.expected, null);
    assert.ok(Object.keys(entry.expected).length > 0, `No expected outcome for ${entry.id}`);
    assert.ok(Array.isArray(entry.requirements) && entry.requirements.length > 0);
    assert.equal(typeof entry.suite, 'string');
  }
});

test('active specification has unique stable requirement definitions', () => {
  const definitions = new Map();
  for (const name of readdirSync('docs/spec').filter(name => name.endsWith('.md'))) {
    const source = readFileSync(`docs/spec/${name}`, 'utf8');
    for (const match of source.matchAll(/^(?:#{2,3} |\*\*)([A-Z][A-Z0-9]*-\d+) [—–-]/gmu)) {
      assert.ok(!definitions.has(match[1]), `Duplicate ${match[1]} in ${name} and ${definitions.get(match[1])}`);
      definitions.set(match[1], name);
    }
  }
  assert.ok(definitions.size > 0);
});
