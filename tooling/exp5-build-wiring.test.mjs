/** Generated EXP-5 declarations must exist before type-aware fixture lint runs on a clean checkout. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/** The normal build is the CI prerequisite for the ordinary check and test commands. */
test('normal build prepares EXP-5 fixture declarations and API models without Java', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const scripts = root.scripts;
  assert.match(scripts.build, /npm run build:experiments/u);
  assert.match(scripts['build:experiments'], /npm run build:exp5-fixtures/u);
  const fixtureBuild = scripts['build:exp5-fixtures'];
  assert.equal(typeof fixtureBuild, 'string');
  const required = [
    'npm ci --prefix experiments/exp-5/fixture',
    'tsc -p experiments/exp-5/fixture/packages/producer/tsconfig.json',
    'api-extractor run --config experiments/exp-5/fixture/packages/producer/api-extractor.json',
    'tsc -p experiments/exp-5/fixture/packages/consumer/tsconfig.json',
    'api-extractor run --config experiments/exp-5/fixture/packages/consumer/api-extractor.json',
  ];
  let previous = -1;
  for (const command of required) {
    const current = fixtureBuild.indexOf(command);
    assert.ok(current > previous, `${command} must follow its generated-declaration prerequisite`);
    previous = current;
  }
  assert.doesNotMatch(fixtureBuild, /gradle|gradlew|java/iu);
});
