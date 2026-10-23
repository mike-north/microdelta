/** The output fixture must compile from the repository's tracked contract alone. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Resolve the fixture's parent config as TypeScript does, relative to itself. */
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = resolve(root, 'scratch/gap-hunt/consumer-dx/tsconfig.output-bindings.json');

test('output fixture inherits only a tracked compiler config', () => {
  const config = JSON.parse(readFileSync(fixture, 'utf8'));
  assert.equal(typeof config.extends, 'string');
  const inherited = resolve(dirname(fixture), config.extends);
  const repositoryPath = relative(root, inherited);
  assert.doesNotThrow(() => execFileSync('git', ['ls-files', '--error-unmatch', '--', repositoryPath], { cwd: root, stdio: 'pipe' }));
});
