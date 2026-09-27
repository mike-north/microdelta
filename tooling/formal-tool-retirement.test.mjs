/** The active quality gates preserve API contracts without requiring dormant formal-tool experiments. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/** This policy test guards executable configuration, not historical records or archived evidence. */
test('normal package gates do not prepare or lint the retired EXP-5 fixture', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const eslint = await readFile(new URL('../eslint.config.mjs', import.meta.url), 'utf8');
  const tsconfig = JSON.parse(await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'));
  const executableScripts = Object.entries(root.scripts)
    .filter(([name]) => name.startsWith('build') || name.startsWith('check') || name.startsWith('test'))
    .map(([, command]) => command)
    .join('\n');

  assert.doesNotMatch(executableScripts, /exp-5|exp5|CML/u);
  assert.doesNotMatch(eslint, /exp-5|EXP-5|CML/u);
  assert.ok(!tsconfig.exclude?.some(path => /exp-5/u.test(path)), 'the retired fixture must not need a TypeScript exclusion');
});

/** Removing the experiment must leave the package declaration-contract gate in ordinary builds. */
test('normal builds continue comparing API Extractor declaration reports', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(root.scripts.build, /npm run build:fixtures/u);
  assert.match(root.scripts['build:fixtures'], /api-extractor run --config fixtures\/declarations\/producer\/api-extractor\.json/u);
});
